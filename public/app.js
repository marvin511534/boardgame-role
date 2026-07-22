const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});

/* 頁面 */
const homePage = document.getElementById("homePage");
const hostRoomPage = document.getElementById("hostRoomPage");
const waitingPage = document.getElementById("waitingPage");
const rolePage = document.getElementById("rolePage");
const roleHiddenPage = document.getElementById("roleHiddenPage");
const hostStartedPage = document.getElementById("hostStartedPage");

/* 首頁 */
const hostNameInput = document.getElementById("hostNameInput");
const playerCountSelect = document.getElementById("playerCount");
const rolePreview = document.getElementById("rolePreview");
const createRoomButton = document.getElementById("createRoomButton");
const roomCodeInput = document.getElementById("roomCodeInput");
const playerNameInput = document.getElementById("playerNameInput");
const joinRoomButton = document.getElementById("joinRoomButton");
const homeMessage = document.getElementById("homeMessage");

/* 房主等待畫面 */
const hostRoomCode = document.getElementById("hostRoomCode");
const qrCodeImage = document.getElementById("qrCodeImage");
const joinUrl = document.getElementById("joinUrl");
const playerProgress = document.getElementById("playerProgress");
const playerList = document.getElementById("playerList");
const startGameButton = document.getElementById("startGameButton");
const closeRoomButton = document.getElementById("closeRoomButton");
const hostMessage = document.getElementById("hostMessage");

/* 玩家等待畫面 */
const waitingPlayerName = document.getElementById("waitingPlayerName");
const waitingRoomCode = document.getElementById("waitingRoomCode");
const waitingMessage = document.getElementById("waitingMessage");

/* 身份畫面 */
const roleIcon = document.getElementById("roleIcon");
const roleName = document.getElementById("roleName");
const hideRoleButton = document.getElementById("hideRoleButton");
const showRoleAgainButton = document.getElementById("showRoleAgainButton");

/* 房主控制畫面 */
const startedRoomCode = document.getElementById("startedRoomCode");
const hostShowRoleButton = document.getElementById("hostShowRoleButton");
const restartGameButton = document.getElementById("restartGameButton");
const closeStartedRoomButton = document.getElementById("closeStartedRoomButton");
const startedMessage = document.getElementById("startedMessage");

let currentRoomCode = "";
let currentPlayerName = "";
let assignedRole = "";
let currentPlayerCount = 0;
let currentPlayerTotal = 0;
let allPlayersAreConnected = true;
let isHost = false;
let gameHasStarted = false;

const roleSettings = {
    4: ["主公", "忠臣", "反賊", "內奸"],
    5: ["主公", "忠臣", "反賊", "反賊", "內奸"],
    6: ["主公", "忠臣", "反賊", "反賊", "反賊", "內奸"],
    7: ["主公", "忠臣", "忠臣", "反賊", "反賊", "反賊", "內奸"],
    8: ["主公", "忠臣", "忠臣", "反賊", "反賊", "反賊", "反賊", "內奸"]
};

function showPage(pageToShow) {
    [homePage, hostRoomPage, waitingPage, rolePage, roleHiddenPage, hostStartedPage]
        .forEach((page) => page.classList.add("hidden"));

    pageToShow.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function saveHostSession(roomCode, hostToken) {
    clearPlayerSession();
    localStorage.setItem("boardgameHostRoomCode", roomCode);
    localStorage.setItem("boardgameHostToken", hostToken);
}

function clearHostSession() {
    localStorage.removeItem("boardgameHostRoomCode");
    localStorage.removeItem("boardgameHostToken");
}

function savePlayerSession(roomCode, playerToken) {
    clearHostSession();
    localStorage.setItem("boardgamePlayerRoomCode", roomCode);
    localStorage.setItem("boardgamePlayerToken", playerToken);
}

function clearPlayerSession() {
    localStorage.removeItem("boardgamePlayerRoomCode");
    localStorage.removeItem("boardgamePlayerToken");
}

function clearAllSessions() {
    clearHostSession();
    clearPlayerSession();
}

function countRoles(roles) {
    const roleCounts = {};

    roles.forEach((role) => {
        roleCounts[role] = (roleCounts[role] || 0) + 1;
    });

    return Object.entries(roleCounts)
        .map(([role, count]) => `${role} × ${count}`)
        .join("　");
}

function updateRolePreview() {
    const playerCount = Number(playerCountSelect.value);
    rolePreview.textContent = countRoles(roleSettings[playerCount]);
}

function resetMessages() {
    homeMessage.textContent = "";
    hostMessage.textContent = "";
    waitingMessage.textContent = "";
    startedMessage.textContent = "";
}

function updateStartButton() {
    const roomIsFull = currentPlayerTotal === currentPlayerCount;
    const canStart = roomIsFull && allPlayersAreConnected;

    startGameButton.disabled = !canStart;

    if (!roomIsFull) {
        startGameButton.textContent =
            `等待玩家加入（${currentPlayerTotal}/${currentPlayerCount}）`;
    } else if (!allPlayersAreConnected) {
        startGameButton.textContent = "等待離線玩家重新連線";
    } else {
        startGameButton.textContent = "開始抽身份";
    }
}

function renderPlayerList(players) {
    playerList.innerHTML = "";

    players.forEach((player, index) => {
        const listItem = document.createElement("li");
        const hostText = player.isHost ? "（房主）" : "";

        if (player.isHost) {
            listItem.classList.add("host-player");
        }

        if (!player.connected) {
            listItem.classList.add("offline-player");
        }

        listItem.textContent = `${index + 1}. ${player.name}${hostText}`;
        playerList.appendChild(listItem);
    });
}

function displayRole(role) {
    assignedRole = role;
    roleName.textContent = role;
    roleName.className = "role-name";

    if (role === "主公") {
        roleIcon.textContent = "👑";
        roleName.classList.add("role-lord");
    } else if (role === "忠臣") {
        roleIcon.textContent = "🛡️";
        roleName.classList.add("role-loyalist");
    } else if (role === "反賊") {
        roleIcon.textContent = "⚔️";
        roleName.classList.add("role-rebel");
    } else {
        roleIcon.textContent = "🕵️";
        roleName.classList.add("role-spy");
    }

    showPage(rolePage);
}

function showPlayerWaitingPage(message = "") {
    waitingPlayerName.textContent = currentPlayerName;
    waitingRoomCode.textContent = currentRoomCode;
    waitingMessage.textContent = message;
    showPage(waitingPage);
}

playerCountSelect.addEventListener("change", updateRolePreview);

createRoomButton.addEventListener("click", () => {
    resetMessages();
    const hostName = hostNameInput.value.trim();

    if (!hostName) {
        homeMessage.textContent = "請輸入房主名稱";
        hostNameInput.focus();
        return;
    }

    createRoomButton.disabled = true;
    createRoomButton.textContent = "建立中……";

    socket.emit("createRoom", {
        playerCount: Number(playerCountSelect.value),
        hostName
    });
});

joinRoomButton.addEventListener("click", () => {
    resetMessages();
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    const playerName = playerNameInput.value.trim();

    if (!roomCode) {
        homeMessage.textContent = "請輸入房號";
        return;
    }

    if (!playerName) {
        homeMessage.textContent = "請輸入玩家名稱";
        return;
    }

    joinRoomButton.disabled = true;
    joinRoomButton.textContent = "加入中……";
    socket.emit("joinRoom", { roomCode, playerName });
});

startGameButton.addEventListener("click", () => {
    hostMessage.textContent = "";
    startGameButton.disabled = true;
    startGameButton.textContent = "分配身份中……";
    socket.emit("startGame", { roomCode: currentRoomCode });
});

hideRoleButton.addEventListener("click", () => {
    if (isHost) {
        startedRoomCode.textContent = currentRoomCode;
        showPage(hostStartedPage);
    } else {
        showPage(roleHiddenPage);
    }
});

showRoleAgainButton.addEventListener("click", () => {
    if (assignedRole) {
        displayRole(assignedRole);
    }
});

hostShowRoleButton.addEventListener("click", () => {
    if (assignedRole) {
        displayRole(assignedRole);
    }
});

restartGameButton.addEventListener("click", () => {
    startedMessage.textContent = "";
    restartGameButton.disabled = true;
    restartGameButton.textContent = "重新抽取中……";
    socket.emit("restartGame", { roomCode: currentRoomCode });
});

closeRoomButton.addEventListener("click", () => {
    if (confirm("確定要關閉房間嗎？")) {
        socket.emit("closeRoom", { roomCode: currentRoomCode });
    }
});

closeStartedRoomButton.addEventListener("click", () => {
    if (confirm("確定要關閉房間嗎？")) {
        socket.emit("closeRoom", { roomCode: currentRoomCode });
    }
});

socket.on("connect", () => {
    console.log("已連線到伺服器：", socket.id);

    const hostRoomCode = localStorage.getItem("boardgameHostRoomCode");
    const hostToken = localStorage.getItem("boardgameHostToken");
    const playerRoomCode = localStorage.getItem("boardgamePlayerRoomCode");
    const playerToken = localStorage.getItem("boardgamePlayerToken");

    if (hostRoomCode && hostToken) {
        socket.emit("reconnectHost", {
            roomCode: hostRoomCode,
            hostToken
        });
    } else if (playerRoomCode && playerToken) {
        socket.emit("reconnectPlayer", {
            roomCode: playerRoomCode,
            playerToken
        });
    }
});

socket.on("roomCreated", (data) => {
    createRoomButton.disabled = false;
    createRoomButton.textContent = "建立房間";
    isHost = true;
    gameHasStarted = false;
    currentRoomCode = data.roomCode;
    currentPlayerName = data.hostName;
    currentPlayerCount = data.playerCount;
    currentPlayerTotal = 1;
    allPlayersAreConnected = true;

    saveHostSession(data.roomCode, data.hostToken);
    hostRoomCode.textContent = data.roomCode;
    qrCodeImage.src = data.qrCodeDataUrl;
    joinUrl.textContent = data.joinUrl;
    playerProgress.textContent = `1 / ${data.playerCount}`;
    updateStartButton();
    showPage(hostRoomPage);
});

socket.on("hostReconnected", (data) => {
    isHost = true;
    currentRoomCode = data.roomCode;
    currentPlayerName = data.hostName;
    currentPlayerCount = data.playerCount;
    currentPlayerTotal = data.players.length;
    allPlayersAreConnected = data.players.every((player) => player.connected);
    gameHasStarted = data.gameStarted;
    assignedRole = data.hostRole || "";

    hostRoomCode.textContent = data.roomCode;
    qrCodeImage.src = data.qrCodeDataUrl;
    joinUrl.textContent = data.joinUrl;
    playerProgress.textContent = `${data.players.length} / ${data.playerCount}`;
    renderPlayerList(data.players);
    hostMessage.textContent = "房主已重新連線";

    if (data.gameStarted && data.hostRole) {
        displayRole(data.hostRole);
    } else {
        updateStartButton();
        showPage(hostRoomPage);
    }
});

socket.on("hostReconnectFailed", (data) => {
    clearHostSession();
    homeMessage.textContent = data.message;
    showPage(homePage);
});

socket.on("joinedRoom", (data) => {
    joinRoomButton.disabled = false;
    joinRoomButton.textContent = "加入房間";
    isHost = false;
    gameHasStarted = false;
    currentRoomCode = data.roomCode;
    currentPlayerName = data.playerName;
    savePlayerSession(data.roomCode, data.playerToken);
    showPlayerWaitingPage("已加入房間，等待房主開始遊戲。");
});

socket.on("playerReconnected", (data) => {
    isHost = false;
    currentRoomCode = data.roomCode;
    currentPlayerName = data.playerName;
    gameHasStarted = data.gameStarted;
    assignedRole = data.role || "";

    if (data.gameStarted && data.role) {
        displayRole(data.role);
    } else {
        showPlayerWaitingPage("已重新連線，等待房主開始遊戲。");
    }
});

socket.on("playerReconnectFailed", (data) => {
    clearPlayerSession();
    assignedRole = "";
    gameHasStarted = false;
    homeMessage.textContent = data.message;
    showPage(homePage);
});

socket.on("playerListUpdated", (data) => {
    currentPlayerCount = data.playerCount;
    currentPlayerTotal = data.players.length;
    allPlayersAreConnected = data.allPlayersConnected;

    if (!isHost) {
        return;
    }

    playerProgress.textContent = `${data.players.length} / ${data.playerCount}`;
    renderPlayerList(data.players);

    if (!data.gameStarted) {
        updateStartButton();
    }
});

socket.on("playerConnectionChanged", (data) => {
    const who = data.isHost ? "房主" : data.playerName;

    if (data.connected) {
        const message = `${who}已重新連線。`;

        if (isHost) {
            hostMessage.textContent = message;
            startedMessage.textContent = message;
        } else {
            waitingMessage.textContent = message;
        }
    } else {
        const message = `${who}暫時離線，將保留 2 分鐘。`;

        if (isHost) {
            hostMessage.textContent = message;
            startedMessage.textContent = message;
        } else {
            waitingMessage.textContent = message;
        }
    }
});

socket.on("playerReconnectExpired", (data) => {
    if (isHost) {
        hostMessage.textContent = `${data.playerName} 已逾時離開房間。`;
        startedMessage.textContent = `${data.playerName} 已逾時離開房間。`;
    } else {
        waitingMessage.textContent = `${data.playerName} 已逾時離開房間。`;
    }
});

socket.on("roleAssigned", (data) => {
    currentRoomCode = data.roomCode;
    currentPlayerName = data.playerName;
    isHost = data.isHost;
    gameHasStarted = true;
    restartGameButton.disabled = false;
    restartGameButton.textContent = "重新抽取身份";
    displayRole(data.role);
});

socket.on("gameStarted", (data) => {
    currentRoomCode = data.roomCode;
    gameHasStarted = true;
    startedRoomCode.textContent = data.roomCode;
});

socket.on("gameRestarted", (data) => {
    currentRoomCode = data.roomCode;
    gameHasStarted = true;
    restartGameButton.disabled = false;
    restartGameButton.textContent = "重新抽取身份";
    startedMessage.textContent = "身份已重新分配完成";
});

socket.on("roomError", (data) => {
    createRoomButton.disabled = false;
    createRoomButton.textContent = "建立房間";
    joinRoomButton.disabled = false;
    joinRoomButton.textContent = "加入房間";
    homeMessage.textContent = data.message;
    showPage(homePage);
});

socket.on("hostError", (data) => {
    startGameButton.disabled = false;
    restartGameButton.disabled = false;
    startGameButton.textContent = "開始抽身份";
    restartGameButton.textContent = "重新抽取身份";

    if (!hostRoomPage.classList.contains("hidden")) {
        hostMessage.textContent = data.message;
    } else {
        startedMessage.textContent = data.message;
    }
});

socket.on("gameCancelled", (data) => {
    alert(data.message);
    assignedRole = "";
    gameHasStarted = false;

    if (isHost) {
        hostMessage.textContent = data.message;
        showPage(hostRoomPage);
        updateStartButton();
    } else {
        showPlayerWaitingPage(data.message);
    }
});

socket.on("roomClosed", () => {
    clearAllSessions();
    alert("房間已關閉");
    window.location.href = "/";
});

socket.on("disconnect", () => {
    console.log("與伺服器中斷連線");

    const message = "連線中斷，正在嘗試自動恢復……";

    if (isHost) {
        hostMessage.textContent = message;
        startedMessage.textContent = message;
    } else {
        waitingMessage.textContent = message;
    }
});

const queryParameters = new URLSearchParams(window.location.search);
const roomFromUrl = queryParameters.get("room");

if (roomFromUrl) {
    roomCodeInput.value = roomFromUrl.trim().toUpperCase();
    playerNameInput.focus();
}

updateRolePreview();
