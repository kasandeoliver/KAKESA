"use strict";

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Request failed.");
    return data;
}

function showPageMessage(message, type = "") {
    const target = document.getElementById("pageMessage");
    target.textContent = message;
    target.className = `message ${type}`;
}

async function loadDashboard() {
    try {
        const [account, meetingData, summary, notificationData] = await Promise.all([
            requestJson("/api/auth/me"),
            requestJson("/api/meetings?limit=5"),
            requestJson("/api/meetings/summary"),
            requestJson("/api/notifications?limit=10")
        ]);
        const user = account.user;
        const meetings = meetingData.meetings;

        document.getElementById("memberName").textContent = user.fullName;
        document.getElementById("accountRole").textContent =
            `${user.role[0].toUpperCase()}${user.role.slice(1)} workspace`;
        document.getElementById("meetingCount").textContent = summary.meetings.total;
        document.getElementById("upcomingCount").textContent = summary.meetings.upcoming;
        document.getElementById("notificationCount").textContent = notificationData.unreadCount;
        document.getElementById("accountName").textContent = user.fullName;
        document.getElementById("accountEmail").textContent = user.email;
        document.getElementById("accountRoleDetails").textContent = user.role;
        document.getElementById("membersLink").classList.toggle(
            "hidden",
            !["admin", "chairperson", "secretary"].includes(user.role)
        );

        const list = document.getElementById("recentMeetings");
        list.replaceChildren();
        if (!meetings.length) {
            list.innerHTML = '<p class="empty-state">No meetings yet. Create one to get started.</p>';
            return;
        }
        for (const meeting of meetings.slice(0, 5)) {
            const item = document.createElement("article");
            item.className = "list-item";
            const details = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = meeting.title;
            const meta = document.createElement("p");
            const date = meeting.startTime
                ? new Date(meeting.startTime).toLocaleString()
                : "No scheduled time";
            meta.textContent = `${date} · ${meeting.participantCount} invited`;
            details.append(title, meta);
            const badge = document.createElement("span");
            badge.className = `badge badge-${meeting.status}`;
            badge.textContent = meeting.status.replace("_", " ");
            item.append(details, badge);
            list.append(item);
        }

        const notifications = document.getElementById("notificationList");
        notifications.replaceChildren();
        if (!notificationData.notifications.length) {
            notifications.append(Object.assign(document.createElement("p"), {
                className: "empty-state",
                textContent: "You have no notifications."
            }));
        }
        for (const item of notificationData.notifications) {
            const row = document.createElement("article");
            row.className = "list-item";
            const copy = document.createElement("div");
            const text = document.createElement("p");
            text.textContent = item.message;
            const time = document.createElement("small");
            time.className = "muted";
            time.textContent = new Date(item.createdAt).toLocaleString();
            copy.append(text, time);
            row.append(copy);
            if (!item.isRead) {
                const button = document.createElement("button");
                button.className = "btn btn-outline";
                button.type = "button";
                button.textContent = "Mark read";
                button.addEventListener("click", async () => {
                    try {
                        await requestJson(`/api/notifications/${item.id}/read`, { method: "PATCH" });
                        await loadDashboard();
                    } catch (error) {
                        showPageMessage(error.message, "error");
                    }
                });
                row.append(button);
            }
            notifications.append(row);
        }
    } catch (error) {
        if (error.message.includes("sign in")) {
            window.location.assign("/");
            return;
        }
        showPageMessage(error.message, "error");
        document.getElementById("recentMeetings").innerHTML =
            '<p class="empty-state">Meetings could not be loaded.</p>';
    }
}

document.getElementById("logoutButton").addEventListener("click", async () => {
    try {
        await requestJson("/api/auth/logout", { method: "POST" });
        window.location.assign("/");
    } catch (error) {
        showPageMessage(error.message, "error");
    }
});

loadDashboard();
