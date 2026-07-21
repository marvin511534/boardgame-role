const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/*
房間資料格式：

rooms = {
    ABC123: {
        hostId: "房主的 socket id",
        playerCount: 4,
        gameStarted: false,
        players: [
            {
                id: "玩家 socket id",
                name: "玩家名稱",
                role: "主公"
            }
        ]
    }
}
*/

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

function createRoomCode() {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

function sendPlayerList(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    io.to(roomCode).emit("playerListUpdated", {
        players: room.players.map((player) => ({
            name: player.name
        })),
        playerCount: room.playerCount,
        gameStarted: room.gameStarted
    });
}

io.on("connection", (socket) => {
    console.log("裝置已連線：", socket.id);

    socket.on("createRoom", async ({ playerCount }) => {
        const normalizedPlayerCount = Number(playerCount);

        if (
            !Number.isInteger(normalizedPlayerCount) ||
            normalizedPlayerCount < 4 ||
            normalizedPlayerCount > 8
        ) {
            socket.emit("roomError", {
                message: "玩家人數必須是 4～8 人"
            });

            return;
        }

        const roomCode = createRoomCode();

        rooms[roomCode] = {
            hostId: socket.id,
            playerCount: normalizedPlayerCount,
            gameStarted: false,
            players: []
        };

        socket.join(roomCode);

        const localIp = getLocalIpAddress();

        const joinUrl =
            `http://${localIp}:${PORT}/?room=${roomCode}`;

        try {
            const qrCodeDataUrl =
                await QRCode.toDataURL(joinUrl, {
                    width: 500,
                    margin: 2
                });

            socket.emit("roomCreated", {
                roomCode,
                playerCount: normalizedPlayerCount,
                joinUrl,
                qrCodeDataUrl
            });

            sendPlayerList(roomCode);
        } catch (error) {
            console.error("QR Code 產生失敗：", error);

            delete rooms[roomCode];

            socket.emit("roomError", {
                message: "QR Code 產生失敗"
            });
        }
    });

    socket.on(
        "joinRoom",
        ({ roomCode, playerName }) => {
            const normalizedRoomCode = String(
                roomCode || ""
            )
                .trim()
                .toUpperCase();

            const normalizedPlayerName = String(
                playerName || ""
            ).trim();

            const room = rooms[normalizedRoomCode];

            if (!room) {
                socket.emit("roomError", {
                    message: "找不到這個房間"
                });

                return;
            }

            if (!normalizedPlayerName) {
                socket.emit("roomError", {
                    message: "請輸入玩家名稱"
                });

                return;
            }

            if (normalizedPlayerName.length > 12) {
                socket.emit("roomError", {
                    message: "玩家名稱最多 12 個字"
                });

                return;
            }

            if (room.gameStarted) {
                socket.emit("roomError", {
                    message: "遊戲已經開始，無法加入"
                });

                return;
            }

            if (
                room.players.length >=
                room.playerCount
            ) {
                socket.emit("roomError", {
                    message: "房間人數已滿"
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
                    message: "你已經加入這個房間"
                });

                return;
            }

            const nameAlreadyExists =
                room.players.some(
                    (player) =>
                        player.name.toLowerCase() ===
                        normalizedPlayerName.toLowerCase()
                );

            if (nameAlreadyExists) {
                socket.emit("roomError", {
                    message: "這個名稱已經有人使用"
                });

                return;
            }

            room.players.push({
                id: socket.id,
                name: normalizedPlayerName,
                role: null
            });

            socket.join(normalizedRoomCode);

            socket.emit("joinedRoom", {
                roomCode: normalizedRoomCode,
                playerName: normalizedPlayerName
            });

            sendPlayerList(normalizedRoomCode);
        }
    );

    socket.on("startGame", ({ roomCode }) => {
        const normalizedRoomCode = String(
            roomCode || ""
        )
            .trim()
            .toUpperCase();

        const room = rooms[normalizedRoomCode];

        if (!room) {
            socket.emit("hostError", {
                message: "找不到這個房間"
            });

            return;
        }

        if (room.hostId !== socket.id) {
            socket.emit("hostError", {
                message: "只有房主可以開始遊戲"
            });

            return;
        }

        if (room.gameStarted) {
            socket.emit("hostError", {
                message: "遊戲已經開始"
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

        const roleSettings =
            getRoleSettings(room.playerCount);

        if (!roleSettings) {
            socket.emit("hostError", {
                message: "身份設定錯誤"
            });

            return;
        }

        const shuffledRoles =
            shuffleArray(roleSettings);

        room.gameStarted = true;

        room.players.forEach((player, index) => {
            player.role = shuffledRoles[index];

            io.to(player.id).emit(
                "roleAssigned",
                {
                    role: player.role,
                    playerName: player.name,
                    roomCode: normalizedRoomCode
                }
            );
        });

        socket.emit("gameStarted", {
            roomCode: normalizedRoomCode
        });

        sendPlayerList(normalizedRoomCode);
    });

    socket.on("restartGame", ({ roomCode }) => {
        const normalizedRoomCode = String(
            roomCode || ""
        )
            .trim()
            .toUpperCase();

        const room = rooms[normalizedRoomCode];

        if (!room) {
            socket.emit("hostError", {
                message: "找不到這個房間"
            });

            return;
        }

        if (room.hostId !== socket.id) {
            socket.emit("hostError", {
                message: "只有房主可以重新抽身份"
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

        const roleSettings =
            getRoleSettings(room.playerCount);

        const shuffledRoles =
            shuffleArray(roleSettings);

        room.gameStarted = true;

        room.players.forEach((player, index) => {
            player.role = shuffledRoles[index];

            io.to(player.id).emit(
                "roleAssigned",
                {
                    role: player.role,
                    playerName: player.name,
                    roomCode: normalizedRoomCode
                }
            );
        });

        socket.emit("gameRestarted", {
            roomCode: normalizedRoomCode
        });

        sendPlayerList(normalizedRoomCode);
    });

    socket.on("closeRoom", ({ roomCode }) => {
        const normalizedRoomCode = String(
            roomCode || ""
        )
            .trim()
            .toUpperCase();

        const room = rooms[normalizedRoomCode];

        if (!room) {
            return;
        }

        if (room.hostId !== socket.id) {
            return;
        }

        io.to(normalizedRoomCode).emit(
            "roomClosed"
        );

        delete rooms[normalizedRoomCode];
    });

    socket.on("disconnect", () => {
        console.log("裝置已離線：", socket.id);

        for (const roomCode of Object.keys(rooms)) {
            const room = rooms[roomCode];

            if (room.hostId === socket.id) {
                io.to(roomCode).emit("roomClosed");

                delete rooms[roomCode];

                continue;
            }

            const playerIndex =
                room.players.findIndex(
                    (player) =>
                        player.id === socket.id
                );

            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);

                if (room.gameStarted) {
                    room.gameStarted = false;

                    io.to(roomCode).emit(
                        "gameCancelled",
                        {
                            message:
                                "有玩家離線，遊戲已取消，請重新等待玩家加入。"
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
    console.log("桌遊身份抽籤系統已啟動");
    console.log("------------------------");
    console.log(
        `電腦網址：http://localhost:${PORT}`
    );
    console.log(
        `手機網址：http://${localIp}:${PORT}`
    );
    console.log("------------------------");
    console.log("");
});