const socket = io();

/* 頁面 */
const homePage =
    document.getElementById("homePage");

const hostRoomPage =
    document.getElementById("hostRoomPage");

const waitingPage =
    document.getElementById("waitingPage");

const rolePage =
    document.getElementById("rolePage");

const roleHiddenPage =
    document.getElementById("roleHiddenPage");

const hostStartedPage =
    document.getElementById("hostStartedPage");

/* 首頁元素 */
const playerCountSelect =
    document.getElementById("playerCount");

const rolePreview =
    document.getElementById("rolePreview");

const createRoomButton =
    document.getElementById("createRoomButton");

const roomCodeInput =
    document.getElementById("roomCodeInput");

const playerNameInput =
    document.getElementById("playerNameInput");

const joinRoomButton =
    document.getElementById("joinRoomButton");

const homeMessage =
    document.getElementById("homeMessage");

/* 房主等待畫面 */
const hostRoomCode =
    document.getElementById("hostRoomCode");

const qrCodeImage =
    document.getElementById("qrCodeImage");

const joinUrl =
    document.getElementById("joinUrl");

const playerProgress =
    document.getElementById("playerProgress");

const playerList =
    document.getElementById("playerList");

const startGameButton =
    document.getElementById("startGameButton");

const closeRoomButton =
    document.getElementById("closeRoomButton");

const hostMessage =
    document.getElementById("hostMessage");

/* 玩家等待畫面 */
const waitingPlayerName =
    document.getElementById("waitingPlayerName");

const waitingRoomCode =
    document.getElementById("waitingRoomCode");

const waitingMessage =
    document.getElementById("waitingMessage");

/* 身份畫面 */
const roleCard =
    document.getElementById("roleCard");

const roleIcon =
    document.getElementById("roleIcon");

const roleName =
    document.getElementById("roleName");

const hideRoleButton =
    document.getElementById("hideRoleButton");

const showRoleAgainButton =
    document.getElementById(
        "showRoleAgainButton"
    );

/* 房主開始畫面 */
const startedRoomCode =
    document.getElementById("startedRoomCode");

const restartGameButton =
    document.getElementById(
        "restartGameButton"
    );

const closeStartedRoomButton =
    document.getElementById(
        "closeStartedRoomButton"
    );

const startedMessage =
    document.getElementById("startedMessage");

/* 暫存資料 */
let currentRoomCode = "";
let currentPlayerName = "";
let assignedRole = "";
let currentPlayerCount = 0;
let currentPlayerTotal = 0;

/* 身份配置 */
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

function showPage(pageToShow) {
    const pages = [
        homePage,
        hostRoomPage,
        waitingPage,
        rolePage,
        roleHiddenPage,
        hostStartedPage
    ];

    pages.forEach((page) => {
        page.classList.add("hidden");
    });

    pageToShow.classList.remove("hidden");

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function countRoles(roles) {
    const roleCounts = {};

    roles.forEach((role) => {
        roleCounts[role] =
            (roleCounts[role] || 0) + 1;
    });

    return Object.entries(roleCounts)
        .map(
            ([role, count]) =>
                `${role} × ${count}`
        )
        .join("　");
}

function updateRolePreview() {
    const playerCount = Number(
        playerCountSelect.value
    );

    rolePreview.textContent =
        countRoles(roleSettings[playerCount]);
}

function resetMessages() {
    homeMessage.textContent = "";
    hostMessage.textContent = "";
    waitingMessage.textContent = "";
    startedMessage.textContent = "";
}

function updateStartButton() {
    const roomIsFull =
        currentPlayerTotal ===
        currentPlayerCount;

    startGameButton.disabled = !roomIsFull;

    if (roomIsFull) {
        startGameButton.textContent =
            "開始抽身份";
    } else {
        startGameButton.textContent =
            `等待玩家加入（${currentPlayerTotal}/${currentPlayerCount}）`;
    }
}

function displayRole(role) {
    assignedRole = role;

    roleName.textContent = role;

    roleName.className = "role-name";

    if (role === "主公") {
        roleIcon.textContent = "👑";

        roleName.classList.add(
            "role-lord"
        );
    } else if (role === "忠臣") {
        roleIcon.textContent = "🛡️";

        roleName.classList.add(
            "role-loyalist"
        );
    } else if (role === "反賊") {
        roleIcon.textContent = "⚔️";

        roleName.classList.add(
            "role-rebel"
        );
    } else {
        roleIcon.textContent = "🕵️";

        roleName.classList.add(
            "role-spy"
        );
    }

    showPage(rolePage);
}

playerCountSelect.addEventListener(
    "change",
    updateRolePreview
);

createRoomButton.addEventListener(
    "click",
    () => {
        resetMessages();

        createRoomButton.disabled = true;
        createRoomButton.textContent =
            "建立中……";

        socket.emit("createRoom", {
            playerCount: Number(
                playerCountSelect.value
            )
        });
    }
);

joinRoomButton.addEventListener(
    "click",
    () => {
        resetMessages();

        const roomCode =
            roomCodeInput.value
                .trim()
                .toUpperCase();

        const playerName =
            playerNameInput.value.trim();

        if (!roomCode) {
            homeMessage.textContent =
                "請輸入房號";

            return;
        }

        if (!playerName) {
            homeMessage.textContent =
                "請輸入玩家名稱";

            return;
        }

        joinRoomButton.disabled = true;
        joinRoomButton.textContent =
            "加入中……";

        socket.emit("joinRoom", {
            roomCode,
            playerName
        });
    }
);

startGameButton.addEventListener(
    "click",
    () => {
        hostMessage.textContent = "";

        if (!currentRoomCode) {
            hostMessage.textContent =
                "房間資料錯誤";

            return;
        }

        startGameButton.disabled = true;
        startGameButton.textContent =
            "分配身份中……";

        socket.emit("startGame", {
            roomCode: currentRoomCode
        });
    }
);

restartGameButton.addEventListener(
    "click",
    () => {
        startedMessage.textContent = "";

        restartGameButton.disabled = true;
        restartGameButton.textContent =
            "重新抽取中……";

        socket.emit("restartGame", {
            roomCode: currentRoomCode
        });
    }
);

hideRoleButton.addEventListener(
    "click",
    () => {
        showPage(roleHiddenPage);
    }
);

showRoleAgainButton.addEventListener(
    "click",
    () => {
        if (assignedRole) {
            showPage(rolePage);
        }
    }
);

closeRoomButton.addEventListener(
    "click",
    () => {
        const shouldClose = confirm(
            "確定要關閉房間嗎？"
        );

        if (!shouldClose) {
            return;
        }

        socket.emit("closeRoom", {
            roomCode: currentRoomCode
        });
    }
);

closeStartedRoomButton.addEventListener(
    "click",
    () => {
        const shouldClose = confirm(
            "確定要關閉房間嗎？"
        );

        if (!shouldClose) {
            return;
        }

        socket.emit("closeRoom", {
            roomCode: currentRoomCode
        });
    }
);

socket.on("connect", () => {
    console.log(
        "已連線到伺服器：",
        socket.id
    );
});

socket.on("roomCreated", (data) => {
    createRoomButton.disabled = false;
    createRoomButton.textContent =
        "建立房間";

    currentRoomCode = data.roomCode;
    currentPlayerCount =
        data.playerCount;
    currentPlayerTotal = 0;

    hostRoomCode.textContent =
        data.roomCode;

    qrCodeImage.src =
        data.qrCodeDataUrl;

    joinUrl.textContent =
        data.joinUrl;

    playerProgress.textContent =
        `0 / ${data.playerCount}`;

    playerList.innerHTML =
        `<li class="empty-player">
            等待玩家加入……
        </li>`;

    updateStartButton();

    showPage(hostRoomPage);
});

socket.on("joinedRoom", (data) => {
    joinRoomButton.disabled = false;
    joinRoomButton.textContent =
        "加入房間";

    currentRoomCode =
        data.roomCode;

    currentPlayerName =
        data.playerName;

    waitingPlayerName.textContent =
        data.playerName;

    waitingRoomCode.textContent =
        data.roomCode;

    showPage(waitingPage);
});

socket.on(
    "playerListUpdated",
    (data) => {
        currentPlayerCount =
            data.playerCount;

        currentPlayerTotal =
            data.players.length;

        playerProgress.textContent =
            `${data.players.length} / ${data.playerCount}`;

        if (
            data.players.length === 0
        ) {
            playerList.innerHTML =
                `<li class="empty-player">
                    等待玩家加入……
                </li>`;
        } else {
            playerList.innerHTML = "";

            data.players.forEach(
                (player, index) => {
                    const listItem =
                        document.createElement(
                            "li"
                        );

                    listItem.textContent =
                        `${index + 1}. ${player.name}`;

                    playerList.appendChild(
                        listItem
                    );
                }
            );
        }

        updateStartButton();
    }
);

socket.on("roleAssigned", (data) => {
    currentRoomCode =
        data.roomCode;

    currentPlayerName =
        data.playerName;

    displayRole(data.role);
});

socket.on("gameStarted", (data) => {
    currentRoomCode =
        data.roomCode;

    startedRoomCode.textContent =
        data.roomCode;

    restartGameButton.disabled = false;
    restartGameButton.textContent =
        "重新抽取身份";

    showPage(hostStartedPage);
});

socket.on("gameRestarted", (data) => {
    currentRoomCode =
        data.roomCode;

    startedMessage.textContent =
        "身份已重新分配完成";

    restartGameButton.disabled = false;
    restartGameButton.textContent =
        "重新抽取身份";
});

socket.on("roomError", (data) => {
    createRoomButton.disabled = false;
    createRoomButton.textContent =
        "建立房間";

    joinRoomButton.disabled = false;
    joinRoomButton.textContent =
        "加入房間";

    homeMessage.textContent =
        data.message;

    showPage(homePage);
});

socket.on("hostError", (data) => {
    startGameButton.disabled = false;
    restartGameButton.disabled = false;

    startGameButton.textContent =
        "開始抽身份";

    restartGameButton.textContent =
        "重新抽取身份";

    if (
        !hostRoomPage.classList.contains(
            "hidden"
        )
    ) {
        hostMessage.textContent =
            data.message;
    } else {
        startedMessage.textContent =
            data.message;
    }
});

socket.on("gameCancelled", (data) => {
    alert(data.message);

    assignedRole = "";

    if (currentPlayerName) {
        waitingMessage.textContent =
            data.message;

        showPage(waitingPage);
    }
});

socket.on("roomClosed", () => {
    alert("房間已關閉");

    window.location.href = "/";
});

socket.on("disconnect", () => {
    console.log("與伺服器中斷連線");
});

/* 掃描 QR Code 時，自動填入房號 */
const queryParameters =
    new URLSearchParams(
        window.location.search
    );

const roomFromUrl =
    queryParameters.get("room");

if (roomFromUrl) {
    roomCodeInput.value =
        roomFromUrl
            .trim()
            .toUpperCase();

    playerNameInput.focus();
}

updateRolePreview();