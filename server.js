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

/* 房主斷線後，房間保留 2 分鐘 */
const HOST_RECONNECT_GRACE_MS = 2 * 60 * 1000;

const rooms = {};

app.use(express.static(path.join(__dirname, "public")));

function getLocalIpAddress() {
    const networkInterfaces = os.networkInterfaces();

    for (const interfaceName of Object.keys(networkInterfaces)) {
        const interfaces = networkInterfaces[interfaceName];

        for (const network of interfaces) {
            if (
                network.family === "IPv4" &&
                network.internal === false
            ) {
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

    const localIp = getLocalIpAddress();

    return `http://${localIp}:${PORT}`;
}

function createRoomCode() {
    const characters =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let roomCode = "";

    do {
        roomCode = "";

        for (let i = 0; i < 6; i += 1) {
            const randomIndex = Math.floor(
                Math.random() * characters.length
            );

            roomCode += characters[randomIndex];
        }
    } while (rooms[roomCode]);

    return roomCode;
}

function createReconnectToken() {
    return crypto.randomBytes(24).toString("hex");
}

function getRoleSettings(playerCount) {
    const roleSettings = {
        4: [
            "主公",
            "忠臣",
            "反賊",
            "內奸"
        ],

        5: [
            "主公",
            "忠臣",
            "反賊",
            "反賊",
            "內奸"
        ],

        6: [
            "主公",
            "忠臣",
            "反賊",
            "反賊",
            "反賊",
            "內奸"
        ],

        7: [
            "主公",
            "忠臣",
            "忠臣",
            "反賊",
            "反賊",
            "反賊",
            "內奸"
        ],

        8: [
            "主公",
            "忠臣",
            "忠臣",
            "反賊",
            "反賊",
            "反賊",
            "反賊",
            "內奸"
        ]
    };

    return roleSettings[playerCount] || null;
}

function shuffleArray(array) {
    const shuffledArray = [...array];

    for (
        let i = shuffledArray.length - 1;
        i > 0;
        i -= 1
    ) {
        const randomIndex = Math.floor(
            Math.random() * (i + 1)
        );

        [
            shuffledArray[i],
            shuffledArray[randomIndex]
        ] = [
            shuffledArray[randomIndex],
            shuffledArray[i]
        ];
    }

    return shuffledArray;
}

function getPublicPlayers(room) {
    return room.players.map((player) => ({
        name: player.name,
        isHost: player.isHost
    }));
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
        hostConnected: room.hostConnected
    });
}

function clearHostCloseTimer(room) {
    if (room.hostCloseTimer) {
        clearTimeout(room.hostCloseTimer);
        room.hostCloseTimer = null;
    }
}

function closeRoom(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    clearHostCloseTimer(room);

    io.to(roomCode).emit("roomClosed");

    delete rooms[roomCode];
}

function scheduleHostRoomClose(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    clearHostCloseTimer(room);

    room.hostCloseTimer = setTimeout(() => {
        const currentRoom = rooms[roomCode];

        if (!currentRoom) {
            return;
        }

        if (currentRoom.hostConnected) {
            return;
        }

        closeRoom(roomCode);
    }, HOST_RECONNECT_GRACE_MS);
}

function assignRoles(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return false;
    }

    const roles = getRoleSettings(
        room.playerCount
    );

    if (!roles) {
        return false;
    }

    const shuffledRoles =
        shuffleArray(roles);

    room.gameStarted = true;

    room.players.forEach((player, index) => {
        player.role = shuffledRoles[index];

        if (player.id) {
            io.to(player.id).emit(
                "roleAssigned",
                {
                    role: player.role,
                    playerName: player.name,
                    roomCode,
                    isHost: player.isHost
                }
            );
        }
    });

    return true;
}

io.on("connection", (socket) => {
    console.log("裝置已連線：", socket.id);

    socket.on(
        "createRoom",
        async ({ playerCount, hostName }) => {
            const normalizedPlayerCount =
                Number(playerCount);

            const normalizedHostName =
                String(hostName || "").trim();

            if (
                !Number.isInteger(
                    normalizedPlayerCount
                ) ||
                normalizedPlayerCount < 4 ||
                normalizedPlayerCount > 8
            ) {
                socket.emit("roomError", {
                    message:
                        "玩家總人數必須是 4～8 人"
                });

                return;
            }

            if (!normalizedHostName) {
                socket.emit("roomError", {
                    message:
                        "請輸入房主名稱"
                });

                return;
            }

            if (normalizedHostName.length > 12) {
                socket.emit("roomError", {
                    message:
                        "玩家名稱最多 12 個字"
                });

                return;
            }

            const roomCode =
                createRoomCode();

            const hostToken =
                createReconnectToken();

            const baseUrl = getBaseUrl();

            const joinUrl =
                `${baseUrl}/?room=${roomCode}`;

            try {
                const qrCodeDataUrl =
                    await QRCode.toDataURL(
                        joinUrl,
                        {
                            width: 500,
                            margin: 2
                        }
                    );

                rooms[roomCode] = {
                    hostId: socket.id,
                    hostToken,
                    hostConnected: true,
                    hostCloseTimer: null,

                    playerCount:
                        normalizedPlayerCount,

                    gameStarted: false,

                    joinUrl,
                    qrCodeDataUrl,

                    players: [
                        {
                            id: socket.id,
                            name: normalizedHostName,
                            role: null,
                            isHost: true
                        }
                    ]
                };

                socket.join(roomCode);

                socket.emit("roomCreated", {
                    roomCode,
                    playerCount:
                        normalizedPlayerCount,
                    hostName:
                        normalizedHostName,
                    hostToken,
                    joinUrl,
                    qrCodeDataUrl
                });

                sendPlayerList(roomCode);
            } catch (error) {
                console.error(
                    "QR Code 產生失敗：",
                    error
                );

                socket.emit("roomError", {
                    message:
                        "QR Code 產生失敗"
                });
            }
        }
    );

    /*
    房主重新連線：
    手機鎖屏或切換 App 後，Socket ID 會改變，
    所以使用 hostToken 恢復房主身份。
    */
    socket.on(
        "reconnectHost",
        ({ roomCode, hostToken }) => {
            const normalizedRoomCode =
                String(roomCode || "")
                    .trim()
                    .toUpperCase();

            const normalizedToken =
                String(hostToken || "").trim();

            const room =
                rooms[normalizedRoomCode];

            if (!room) {
                socket.emit(
                    "hostReconnectFailed",
                    {
                        message:
                            "房間已不存在或已逾時關閉"
                    }
                );

                return;
            }

            if (
                !normalizedToken ||
                room.hostToken !== normalizedToken
            ) {
                socket.emit(
                    "hostReconnectFailed",
                    {
                        message:
                            "無法驗證房主身份"
                    }
                );

                return;
            }

            clearHostCloseTimer(room);

            room.hostId = socket.id;
            room.hostConnected = true;

            const hostPlayer =
                room.players.find(
                    (player) =>
                        player.isHost
                );

            if (hostPlayer) {
                hostPlayer.id = socket.id;
            }

            socket.join(normalizedRoomCode);

            socket.emit("hostReconnected", {
                roomCode:
                    normalizedRoomCode,

                playerCount:
                    room.playerCount,

                players:
                    getPublicPlayers(room),

                gameStarted:
                    room.gameStarted,

                hostName:
                    hostPlayer
                        ? hostPlayer.name
                        : "",

                hostRole:
                    hostPlayer
                        ? hostPlayer.role
                        : null,

                joinUrl:
                    room.joinUrl,

                qrCodeDataUrl:
                    room.qrCodeDataUrl
            });

            io.to(normalizedRoomCode).emit(
                "hostConnectionChanged",
                {
                    connected: true
                }
            );

            sendPlayerList(
                normalizedRoomCode
            );
        }
    );

    socket.on(
        "joinRoom",
        ({ roomCode, playerName }) => {
            const normalizedRoomCode =
                String(roomCode || "")
                    .trim()
                    .toUpperCase();

            const normalizedPlayerName =
                String(playerName || "").trim();

            const room =
                rooms[normalizedRoomCode];

            if (!room) {
                socket.emit("roomError", {
                    message:
                        "找不到這個房間"
                });

                return;
            }

            if (!room.hostConnected) {
                socket.emit("roomError", {
                    message:
                        "房主目前離線，請稍後再試"
                });

                return;
            }

            if (!normalizedPlayerName) {
                socket.emit("roomError", {
                    message:
                        "請輸入玩家名稱"
                });

                return;
            }

            if (
                normalizedPlayerName.length > 12
            ) {
                socket.emit("roomError", {
                    message:
                        "玩家名稱最多 12 個字"
                });

                return;
            }

            if (room.gameStarted) {
                socket.emit("roomError", {
                    message:
                        "遊戲已經開始，無法加入"
                });

                return;
            }

            if (
                room.players.length >=
                room.playerCount
            ) {
                socket.emit("roomError", {
                    message:
                        "房間人數已滿"
                });

                return;
            }

            const playerAlreadyJoined =
                room.players.some(
                    (player) =>
                        player.id === socket.id
                );

            if (playerAlreadyJoined) {
                socket.emit("roomError", {
                    message:
                        "你已經加入這個房間"
                });

                return;
            }

            const nameAlreadyExists =
                room.players.some(
                    (player) =>
                        player.name
                            .toLowerCase() ===
                        normalizedPlayerName
                            .toLowerCase()
                );

            if (nameAlreadyExists) {
                socket.emit("roomError", {
                    message:
                        "這個名稱已經有人使用"
                });

                return;
            }

            room.players.push({
                id: socket.id,
                name: normalizedPlayerName,
                role: null,
                isHost: false
            });

            socket.join(normalizedRoomCode);

            socket.emit("joinedRoom", {
                roomCode:
                    normalizedRoomCode,

                playerName:
                    normalizedPlayerName
            });

            sendPlayerList(
                normalizedRoomCode
            );
        }
    );

    socket.on(
        "startGame",
        ({ roomCode }) => {
            const normalizedRoomCode =
                String(roomCode || "")
                    .trim()
                    .toUpperCase();

            const room =
                rooms[normalizedRoomCode];

            if (!room) {
                socket.emit("hostError", {
                    message:
                        "找不到這個房間"
                });

                return;
            }

            if (room.hostId !== socket.id) {
                socket.emit("hostError", {
                    message:
                        "只有房主可以開始遊戲"
                });

                return;
            }

            if (
                room.players.length !==
                room.playerCount
            ) {
                socket.emit("hostError", {
                    message:
                        `目前有 ${room.players.length} 人，` +
                        `需要 ${room.playerCount} 人才能開始`
                });

                return;
            }

            const success =
                assignRoles(
                    normalizedRoomCode
                );

            if (!success) {
                socket.emit("hostError", {
                    message:
                        "身份設定錯誤"
                });

                return;
            }

            io.to(normalizedRoomCode).emit(
                "gameStarted",
                {
                    roomCode:
                        normalizedRoomCode
                }
            );

            sendPlayerList(
                normalizedRoomCode
            );
        }
    );

    socket.on(
        "restartGame",
        ({ roomCode }) => {
            const normalizedRoomCode =
                String(roomCode || "")
                    .trim()
                    .toUpperCase();

            const room =
                rooms[normalizedRoomCode];

            if (!room) {
                socket.emit("hostError", {
                    message:
                        "找不到這個房間"
                });

                return;
            }

            if (room.hostId !== socket.id) {
                socket.emit("hostError", {
                    message:
                        "只有房主可以重新抽身份"
                });

                return;
            }

            if (
                room.players.length !==
                room.playerCount
            ) {
                socket.emit("hostError", {
                    message:
                        `目前有 ${room.players.length} 人，` +
                        `需要 ${room.playerCount} 人才能重新抽取`
                });

                return;
            }

            const success =
                assignRoles(
                    normalizedRoomCode
                );

            if (!success) {
                socket.emit("hostError", {
                    message:
                        "身份設定錯誤"
                });

                return;
            }

            io.to(normalizedRoomCode).emit(
                "gameRestarted",
                {
                    roomCode:
                        normalizedRoomCode
                }
            );

            sendPlayerList(
                normalizedRoomCode
            );
        }
    );

    socket.on(
        "closeRoom",
        ({ roomCode }) => {
            const normalizedRoomCode =
                String(roomCode || "")
                    .trim()
                    .toUpperCase();

            const room =
                rooms[normalizedRoomCode];

            if (!room) {
                return;
            }

            if (room.hostId !== socket.id) {
                return;
            }

            closeRoom(normalizedRoomCode);
        }
    );

    socket.on("disconnect", () => {
        console.log(
            "裝置已離線：",
            socket.id
        );

        for (
            const roomCode of
            Object.keys(rooms)
        ) {
            const room = rooms[roomCode];

            /*
            房主斷線：
            不立即刪除房間，改成保留 2 分鐘。
            */
            if (room.hostId === socket.id) {
                room.hostConnected = false;
                room.hostId = null;

                const hostPlayer =
                    room.players.find(
                        (player) =>
                            player.isHost
                    );

                if (hostPlayer) {
                    hostPlayer.id = null;
                }

                io.to(roomCode).emit(
                    "hostConnectionChanged",
                    {
                        connected: false,
                        graceSeconds:
                            HOST_RECONNECT_GRACE_MS /
                            1000
                    }
                );

                scheduleHostRoomClose(
                    roomCode
                );

                continue;
            }

            const playerIndex =
                room.players.findIndex(
                    (player) =>
                        player.id === socket.id &&
                        !player.isHost
                );

            if (playerIndex !== -1) {
                room.players.splice(
                    playerIndex,
                    1
                );

                if (room.gameStarted) {
                    room.gameStarted = false;

                    room.players.forEach(
                        (player) => {
                            player.role = null;
                        }
                    );

                    io.to(roomCode).emit(
                        "gameCancelled",
                        {
                            message:
                                "有玩家離線，遊戲已取消，請等待玩家重新加入。"
                        }
                    );
                }

                sendPlayerList(roomCode);
            }
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    const localIp = getLocalIpAddress();

    console.log("");
    console.log(
        "桌遊身份抽籤系統已啟動"
    );
    console.log("------------------------");
    console.log(
        `電腦網址：http://localhost:${PORT}`
    );
    console.log(
        `區域網路：http://${localIp}:${PORT}`
    );
    console.log("------------------------");
    console.log("");
});