const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    pingTimeout: 30000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
const rooms = {};

app.use(express.static(path.join(__dirname, "public")));

function getLocalIpAddress() {
    const networkInterfaces = os.networkInterfaces();

    for (const interfaceName of Object.keys(networkInterfaces)) {
        const interfaces = networkInterfaces[interfaceName];

        for (const network of interfaces) {
            if (network.family === "IPv4" && !network.internal) {
                return network.address;
            }
        }
    }

    return "localhost";
}

function getBaseUrl() {
    if (process.env.RENDER_EXTERNAL_URL) {
        return process.env.RENDER_EXTERNAL_URL;
    }

    return `http://${getLocalIpAddress()}:${PORT}`;
}

function createRoomCode() {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let roomCode = "";

    do {
        roomCode = "";

        for (let i = 0; i < 6; i += 1) {
            roomCode += characters[Math.floor(Math.random() * characters.length)];
        }
    } while (rooms[roomCode]);

    return roomCode;
}

function createReconnectToken() {
    return crypto.randomBytes(24).toString("hex");
}

function getRoleSettings(playerCount) {
    const roleSettings = {
        4: ["主公", "忠臣", "反賊", "內奸"],
        5: ["主公", "忠臣", "反賊", "反賊", "內奸"],
        6: ["主公", "忠臣", "反賊", "反賊", "反賊", "內奸"],
        7: ["主公", "忠臣", "忠臣", "反賊", "反賊", "反賊", "內奸"],
        8: ["主公", "忠臣", "忠臣", "反賊", "反賊", "反賊", "反賊", "內奸"]
    };

    return roleSettings[playerCount] || null;
}

function shuffleArray(array) {
    const shuffledArray = [...array];

    for (let i = shuffledArray.length - 1; i > 0; i -= 1) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        [shuffledArray[i], shuffledArray[randomIndex]] = [
            shuffledArray[randomIndex],
            shuffledArray[i]
        ];
    }

    return shuffledArray;
}

function getPublicPlayers(room) {
    return room.players.map((player) => ({
        name: player.name,
        isHost: player.isHost,
        connected: player.connected
    }));
}

function allPlayersConnected(room) {
    return room.players.every((player) => player.connected);
}

function clearReconnectTimer(player) {
    if (player.reconnectTimer) {
        clearTimeout(player.reconnectTimer);
        player.reconnectTimer = null;
    }
}

function sendPlayerList(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    io.to(roomCode).emit("playerListUpdated", {
        players: getPublicPlayers(room),
        playerCount: room.playerCount,
        gameStarted: room.gameStarted,
        allPlayersConnected: allPlayersConnected(room)
    });
}

function closeRoom(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    room.players.forEach(clearReconnectTimer);
    io.to(roomCode).emit("roomClosed");
    delete rooms[roomCode];
}

function cancelGame(roomCode, message) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    room.gameStarted = false;
    room.players.forEach((player) => {
        player.role = null;
    });

    io.to(roomCode).emit("gameCancelled", { message });
}

function scheduleDisconnectedPlayerRemoval(roomCode, playerToken) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    const player = room.players.find((item) => item.token === playerToken);

    if (!player) {
        return;
    }

    clearReconnectTimer(player);

    player.reconnectTimer = setTimeout(() => {
        const currentRoom = rooms[roomCode];

        if (!currentRoom) {
            return;
        }

        const currentPlayerIndex = currentRoom.players.findIndex(
            (item) => item.token === playerToken
        );

        if (currentPlayerIndex === -1) {
            return;
        }

        const currentPlayer = currentRoom.players[currentPlayerIndex];

        if (currentPlayer.connected) {
            return;
        }

        if (currentPlayer.isHost) {
            closeRoom(roomCode);
            return;
        }

        const removedName = currentPlayer.name;
        const gameWasStarted = currentRoom.gameStarted;
        currentRoom.players.splice(currentPlayerIndex, 1);

        io.to(roomCode).emit("playerReconnectExpired", {
            playerName: removedName
        });

        if (gameWasStarted) {
            cancelGame(
                roomCode,
                `${removedName} 超過 2 分鐘未重新連線，本局已取消，請等待玩家重新加入。`
            );
        }

        sendPlayerList(roomCode);
    }, RECONNECT_GRACE_MS);
}

function assignRoles(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return false;
    }

    const roles = getRoleSettings(room.playerCount);

    if (!roles) {
        return false;
    }

    const shuffledRoles = shuffleArray(roles);
    room.gameStarted = true;

    room.players.forEach((player, index) => {
        player.role = shuffledRoles[index];

        if (player.connected && player.id) {
            io.to(player.id).emit("roleAssigned", {
                role: player.role,
                playerName: player.name,
                roomCode,
                isHost: player.isHost
            });
        }
    });

    return true;
}

function normalizeRoomCode(roomCode) {
    return String(roomCode || "").trim().toUpperCase();
}

io.on("connection", (socket) => {
    console.log("裝置已連線：", socket.id);

    socket.on("createRoom", async ({ playerCount, hostName }) => {
        const normalizedPlayerCount = Number(playerCount);
        const normalizedHostName = String(hostName || "").trim();

        if (
            !Number.isInteger(normalizedPlayerCount) ||
            normalizedPlayerCount < 4 ||
            normalizedPlayerCount > 8
        ) {
            socket.emit("roomError", { message: "玩家總人數必須是 4～8 人" });
            return;
        }

        if (!normalizedHostName) {
            socket.emit("roomError", { message: "請輸入房主名稱" });
            return;
        }

        if (normalizedHostName.length > 12) {
            socket.emit("roomError", { message: "玩家名稱最多 12 個字" });
            return;
        }

        const roomCode = createRoomCode();
        const hostToken = createReconnectToken();
        const joinUrl = `${getBaseUrl()}/?room=${roomCode}`;

        try {
            const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
                width: 500,
                margin: 2
            });

            rooms[roomCode] = {
                playerCount: normalizedPlayerCount,
                gameStarted: false,
                joinUrl,
                qrCodeDataUrl,
                players: [
                    {
                        id: socket.id,
                        token: hostToken,
                        name: normalizedHostName,
                        role: null,
                        isHost: true,
                        connected: true,
                        reconnectTimer: null
                    }
                ]
            };

            socket.join(roomCode);
            socket.emit("roomCreated", {
                roomCode,
                playerCount: normalizedPlayerCount,
                hostName: normalizedHostName,
                hostToken,
                joinUrl,
                qrCodeDataUrl
            });

            sendPlayerList(roomCode);
        } catch (error) {
            console.error("QR Code 產生失敗：", error);
            socket.emit("roomError", { message: "QR Code 產生失敗" });
        }
    });

    socket.on("reconnectHost", ({ roomCode, hostToken }) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const normalizedToken = String(hostToken || "").trim();
        const room = rooms[normalizedRoomCode];

        if (!room) {
            socket.emit("hostReconnectFailed", {
                message: "房間已不存在或已逾時關閉"
            });
            return;
        }

        const hostPlayer = room.players.find(
            (player) => player.isHost && player.token === normalizedToken
        );

        if (!hostPlayer) {
            socket.emit("hostReconnectFailed", { message: "無法驗證房主身份" });
            return;
        }

        clearReconnectTimer(hostPlayer);
        hostPlayer.id = socket.id;
        hostPlayer.connected = true;
        socket.join(normalizedRoomCode);

        socket.emit("hostReconnected", {
            roomCode: normalizedRoomCode,
            playerCount: room.playerCount,
            players: getPublicPlayers(room),
            gameStarted: room.gameStarted,
            hostName: hostPlayer.name,
            hostRole: hostPlayer.role,
            joinUrl: room.joinUrl,
            qrCodeDataUrl: room.qrCodeDataUrl
        });

        io.to(normalizedRoomCode).emit("playerConnectionChanged", {
            playerName: hostPlayer.name,
            isHost: true,
            connected: true
        });

        sendPlayerList(normalizedRoomCode);
    });

    socket.on("joinRoom", ({ roomCode, playerName }) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const normalizedPlayerName = String(playerName || "").trim();
        const room = rooms[normalizedRoomCode];

        if (!room) {
            socket.emit("roomError", { message: "找不到這個房間" });
            return;
        }

        const hostPlayer = room.players.find((player) => player.isHost);

        if (!hostPlayer || !hostPlayer.connected) {
            socket.emit("roomError", { message: "房主目前離線，請稍後再試" });
            return;
        }

        if (!normalizedPlayerName) {
            socket.emit("roomError", { message: "請輸入玩家名稱" });
            return;
        }

        if (normalizedPlayerName.length > 12) {
            socket.emit("roomError", { message: "玩家名稱最多 12 個字" });
            return;
        }

        if (room.gameStarted) {
            socket.emit("roomError", { message: "遊戲已經開始，無法加入" });
            return;
        }

        if (room.players.length >= room.playerCount) {
            socket.emit("roomError", { message: "房間人數已滿" });
            return;
        }

        if (room.players.some((player) => player.id === socket.id)) {
            socket.emit("roomError", { message: "你已經加入這個房間" });
            return;
        }

        if (
            room.players.some(
                (player) =>
                    player.name.toLowerCase() === normalizedPlayerName.toLowerCase()
            )
        ) {
            socket.emit("roomError", { message: "這個名稱已經有人使用" });
            return;
        }

        const playerToken = createReconnectToken();

        room.players.push({
            id: socket.id,
            token: playerToken,
            name: normalizedPlayerName,
            role: null,
            isHost: false,
            connected: true,
            reconnectTimer: null
        });

        socket.join(normalizedRoomCode);
        socket.emit("joinedRoom", {
            roomCode: normalizedRoomCode,
            playerName: normalizedPlayerName,
            playerToken
        });

        sendPlayerList(normalizedRoomCode);
    });

    socket.on("reconnectPlayer", ({ roomCode, playerToken }) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const normalizedToken = String(playerToken || "").trim();
        const room = rooms[normalizedRoomCode];

        if (!room) {
            socket.emit("playerReconnectFailed", {
                message: "房間已不存在或玩家重連時間已逾時"
            });
            return;
        }

        const player = room.players.find(
            (item) => !item.isHost && item.token === normalizedToken
        );

        if (!player) {
            socket.emit("playerReconnectFailed", {
                message: "找不到原本的玩家資料，請重新加入房間"
            });
            return;
        }

        clearReconnectTimer(player);
        player.id = socket.id;
        player.connected = true;
        socket.join(normalizedRoomCode);

        socket.emit("playerReconnected", {
            roomCode: normalizedRoomCode,
            playerName: player.name,
            gameStarted: room.gameStarted,
            role: player.role
        });

        io.to(normalizedRoomCode).emit("playerConnectionChanged", {
            playerName: player.name,
            isHost: false,
            connected: true
        });

        sendPlayerList(normalizedRoomCode);
    });

    socket.on("startGame", ({ roomCode }) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const room = rooms[normalizedRoomCode];

        if (!room) {
            socket.emit("hostError", { message: "找不到這個房間" });
            return;
        }

        const hostPlayer = room.players.find((player) => player.isHost);

        if (!hostPlayer || hostPlayer.id !== socket.id) {
            socket.emit("hostError", { message: "只有房主可以開始遊戲" });
            return;
        }

        if (room.players.length !== room.playerCount) {
            socket.emit("hostError", {
                message: `目前有 ${room.players.length} 人，需要 ${room.playerCount} 人才能開始`
            });
            return;
        }

        if (!allPlayersConnected(room)) {
            socket.emit("hostError", { message: "有玩家暫時離線，請等待重新連線" });
            return;
        }

        if (!assignRoles(normalizedRoomCode)) {
            socket.emit("hostError", { message: "身份設定錯誤" });
            return;
        }

        io.to(normalizedRoomCode).emit("gameStarted", {
            roomCode: normalizedRoomCode
        });
        sendPlayerList(normalizedRoomCode);
    });

    socket.on("restartGame", ({ roomCode }) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const room = rooms[normalizedRoomCode];

        if (!room) {
            socket.emit("hostError", { message: "找不到這個房間" });
            return;
        }

        const hostPlayer = room.players.find((player) => player.isHost);

        if (!hostPlayer || hostPlayer.id !== socket.id) {
            socket.emit("hostError", { message: "只有房主可以重新抽身份" });
            return;
        }

        if (room.players.length !== room.playerCount) {
            socket.emit("hostError", {
                message: `目前有 ${room.players.length} 人，需要 ${room.playerCount} 人才能重新抽取`
            });
            return;
        }

        if (!allPlayersConnected(room)) {
            socket.emit("hostError", { message: "有玩家暫時離線，請等待重新連線" });
            return;
        }

        if (!assignRoles(normalizedRoomCode)) {
            socket.emit("hostError", { message: "身份設定錯誤" });
            return;
        }

        io.to(normalizedRoomCode).emit("gameRestarted", {
            roomCode: normalizedRoomCode
        });
        sendPlayerList(normalizedRoomCode);
    });

    socket.on("closeRoom", ({ roomCode }) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const room = rooms[normalizedRoomCode];

        if (!room) {
            return;
        }

        const hostPlayer = room.players.find((player) => player.isHost);

        if (hostPlayer && hostPlayer.id === socket.id) {
            closeRoom(normalizedRoomCode);
        }
    });

    socket.on("disconnect", () => {
        console.log("裝置已離線：", socket.id);

        for (const roomCode of Object.keys(rooms)) {
            const room = rooms[roomCode];
            const player = room.players.find((item) => item.id === socket.id);

            if (!player) {
                continue;
            }

            player.id = null;
            player.connected = false;

            io.to(roomCode).emit("playerConnectionChanged", {
                playerName: player.name,
                isHost: player.isHost,
                connected: false,
                graceSeconds: RECONNECT_GRACE_MS / 1000
            });

            sendPlayerList(roomCode);
            scheduleDisconnectedPlayerRemoval(roomCode, player.token);
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    const localIp = getLocalIpAddress();

    console.log("");
    console.log("桌遊身份抽籤系統已啟動");
    console.log("------------------------");
    console.log(`電腦網址：http://localhost:${PORT}`);
    console.log(`區域網路：http://${localIp}:${PORT}`);
    console.log("------------------------");
    console.log("");
});
