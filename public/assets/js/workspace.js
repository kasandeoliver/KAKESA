"use strict";

const page = document.body.dataset.page;
const state = {
    user: null,
    memberPage: 1,
    meetingPage: 1,
    selectedMeeting: null,
    serverOffset: 0,
    countdownTimer: null,
    invitedMemberIds: new Set()
};
const privilegedRoles = ["admin", "chairperson", "secretary"];

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });
    const result = await response.json();
    if (!response.ok) {
        if (response.status === 401) window.location.assign("/login.html");
        throw new Error(result.message || "The request could not be completed.");
    }
    return result;
}

function message(text, type = "") {
    const target = document.getElementById("pageMessage");
    if (!target) return;
    target.textContent = text;
    target.className = `message ${type}`;
}

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function formatDate(value) {
    if (!value) return "No scheduled time";
    return new Date(value).toLocaleString();
}

async function loadCurrentUser() {
    const result = await api("/api/auth/me");
    state.user = result.user;
    document.querySelectorAll("#membersLink").forEach((link) => {
        link.classList.toggle("hidden", !privilegedRoles.includes(state.user.role));
    });
    return result.user;
}

async function logout() {
    try {
        await api("/api/auth/logout", { method: "POST" });
        window.location.assign("/");
    } catch (error) {
        message(error.message, "error");
    }
}

document.getElementById("logoutButton")?.addEventListener("click", logout);

function renderMeetings(meetings, serverTime) {
    const list = document.getElementById("meetingList");
    list.replaceChildren();
    clearInterval(state.countdownTimer);
    if (!meetings.length) {
        list.append(makeElement("p", "empty-state", "No meetings match this view."));
        return;
    }

    state.serverOffset = Date.now() - Date.parse(serverTime);
    for (const meeting of meetings) {
        const row = makeElement("article", "list-item");
        const details = makeElement("div");
        details.append(
            makeElement("h3", "", meeting.title),
            makeElement("p", "", `${formatDate(meeting.startTime)} · ${meeting.participantCount} invited`)
        );
        if (meeting.meetingType === "timed" && meeting.endTime && meeting.status === "in_progress") {
            const timer = makeElement("small", "muted");
            timer.dataset.endTime = meeting.endTime;
            details.append(timer);
        }

        const actions = makeElement("div", "button-row");
        const badge = makeElement("span", `badge badge-${meeting.status}`, meeting.status.replace("_", " "));
        const open = makeElement("button", "btn btn-outline", "Details");
        open.type = "button";
        open.dataset.meetingId = meeting.id;
        actions.append(badge, open);
        row.append(details, actions);
        list.append(row);
    }

    updateCountdowns();
    state.countdownTimer = setInterval(updateCountdowns, 1000);
}

function updateCountdowns() {
    document.querySelectorAll("[data-end-time]").forEach((timer) => {
        const remainingSeconds = Math.max(
            0,
            Math.floor((Date.parse(timer.dataset.endTime) - (Date.now() - state.serverOffset)) / 1000)
        );
        timer.textContent = remainingSeconds
            ? `${Math.floor(remainingSeconds / 60)} min ${remainingSeconds % 60} sec remaining`
            : "Scheduled end time reached";
    });
}

async function loadMeetings() {
    const status = document.getElementById("statusFilter")?.value || "";
    const query = new URLSearchParams({ limit: "25", page: String(state.meetingPage) });
    if (status) query.set("status", status);
    try {
        const result = await api(`/api/meetings?${query}`);
        renderMeetings(result.meetings, result.serverTime);
        const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.limit));
        const previous = document.getElementById("previousMeetingsPage");
        const next = document.getElementById("nextMeetingsPage");
        if (previous && next) {
            previous.disabled = state.meetingPage <= 1;
            next.disabled = state.meetingPage >= totalPages;
            document.getElementById("meetingPaginationInfo").textContent =
                `Page ${state.meetingPage} of ${totalPages} · ${result.pagination.total} meetings`;
        }
    } catch (error) {
        message(error.message, "error");
        document.getElementById("meetingList").replaceChildren(
            makeElement("p", "empty-state", "Meetings could not be loaded.")
        );
    }
}

function setMeetingTypeFields() {
    const timed = document.getElementById("meetingType").value === "timed";
    document.querySelectorAll(".timed-field").forEach((field) => {
        field.classList.toggle("hidden", !timed);
        const input = field.querySelector("input");
        input.required = timed;
    });
}

async function loadInvitePicker(search = "") {
    const picker = document.getElementById("memberPicker");
    try {
        const params = new URLSearchParams({ limit: "100", search });
        const result = await api(`/api/users?${params}`);
        picker.replaceChildren();
        const chairperson = document.getElementById("chairpersonId");
        const secretary = document.getElementById("secretaryId");
        for (const user of result.users) {
            if (user.status !== "active") continue;
            if (user.role === "chairperson") {
                chairperson.append(new Option(user.fullName, user.id));
            }
            if (user.role === "secretary") {
                secretary.append(new Option(user.fullName, user.id));
            }
            if (Number(user.id) === Number(state.user.id)) continue;
            const label = makeElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = user.id;
            checkbox.checked = state.invitedMemberIds.has(Number(user.id));
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) state.invitedMemberIds.add(Number(user.id));
                else state.invitedMemberIds.delete(Number(user.id));
            });
            label.append(checkbox, document.createTextNode(`${user.fullName} · ${user.email}`));
            picker.append(label);
        }
        if (!picker.children.length) picker.append(makeElement("p", "muted", "No other active members found."));
    } catch (error) {
        picker.textContent = error.message;
    }
}

async function createMeeting(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    const values = new FormData(form);
    const start = values.get("startTime");
    const end = values.get("endTime");
    const participantIds = [...state.invitedMemberIds];
    const payload = {
        title: values.get("title"),
        description: values.get("description"),
        meetingType: values.get("meetingType"),
        startTime: start ? new Date(start).toISOString() : null,
        endTime: end ? new Date(end).toISOString() : null,
        agenda: String(values.get("agenda") || "")
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
        chairpersonId: values.get("chairpersonId") || null,
        secretaryId: values.get("secretaryId") || null,
        participantIds
    };

    try {
        const result = await api("/api/meetings", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        form.reset();
        state.invitedMemberIds.clear();
        document.getElementById("meetingFormPanel").classList.add("hidden");
        message(`Meeting “${result.meeting.title}” was created.`, "success");
        await loadMeetings();
    } catch (error) {
        message(error.message, "error");
    } finally {
        submit.disabled = false;
    }
}

async function showMeetingDetails(meetingId) {
    const panel = document.getElementById("meetingDetails");
    panel.classList.remove("hidden");
    panel.replaceChildren(makeElement("p", "muted", "Loading meeting..."));
    try {
        const result = await api(`/api/meetings/${meetingId}`);
        const meeting = result.meeting;
        panel.replaceChildren();
        const heading = makeElement("div", "panel-head");
        const titleGroup = makeElement("div");
        titleGroup.append(
            makeElement("h2", "", meeting.title),
            makeElement("p", "muted", `${meeting.meetingType} · ${meeting.status} · ${formatDate(meeting.startTime)}`)
        );
        heading.append(titleGroup);

        const attendanceButton = makeElement("button", "btn btn-primary", "Mark my attendance");
        attendanceButton.type = "button";
        attendanceButton.addEventListener("click", async () => {
            try {
                await api(`/api/meetings/${meetingId}/attendance`, { method: "POST" });
                message("Your attendance has been recorded.", "success");
                await showMeetingDetails(meetingId);
            } catch (error) {
                message(error.message, "error");
            }
        });
        heading.append(attendanceButton);
        panel.append(heading);

        const description = makeElement("p", "muted", meeting.description || "No description provided.");
        panel.append(description);
        const agendaTitle = makeElement("h3", "", "Agenda");
        panel.append(agendaTitle);
        const agenda = makeElement("ol", "stack");
        for (const item of meeting.agenda) agenda.append(makeElement("li", "", item.title));
        if (!meeting.agenda.length) agenda.append(makeElement("li", "muted", "No agenda items."));
        panel.append(agenda);

        const memberTitle = makeElement("h3", "mt-24", "Invited members");
        panel.append(memberTitle);
        const memberList = makeElement("div", "list");
        for (const member of meeting.members) {
            const row = makeElement("div", "list-item");
            row.append(makeElement(
                "p",
                "",
                `${member.fullName} · ${member.invitationStatus}`
            ));
            if (
                Number(member.id) === Number(state.user.id)
                && member.invitationStatus === "invited"
            ) {
                for (const status of ["accepted", "declined"]) {
                    const button = makeElement("button", "btn btn-outline", status);
                    button.type = "button";
                    button.addEventListener("click", async () => {
                        try {
                            await api(`/api/meetings/${meetingId}/invitation`, {
                                method: "PATCH",
                                body: JSON.stringify({ invitationStatus: status })
                            });
                            await showMeetingDetails(meetingId);
                        } catch (error) {
                            message(error.message, "error");
                        }
                    });
                    row.append(button);
                }
            }
            memberList.append(row);
        }
        if (!meeting.members.length) memberList.append(makeElement("p", "muted", "No members invited."));
        panel.append(memberList);

        const attendanceTitle = makeElement("h3", "mt-24", "Attendance");
        panel.append(attendanceTitle);
        panel.append(makeElement(
            "p",
            "muted",
            meeting.attendance.map((person) => person.fullName).join(", ") || "No attendance recorded."
        ));

        if (
            ["admin", "chairperson"].includes(state.user.role)
            && (state.user.role === "admin"
                || Number(meeting.createdBy) === Number(state.user.id)
                || Number(meeting.chairpersonId) === Number(state.user.id))
        ) {
            const statusControl = document.createElement("select");
            statusControl.className = "field-control";
            for (const value of ["scheduled", "in_progress", "completed", "cancelled"]) {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = value.replace("_", " ");
                option.selected = value === meeting.status;
                statusControl.append(option);
            }
            statusControl.addEventListener("change", async () => {
                try {
                    await api(`/api/meetings/${meetingId}/status`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: statusControl.value })
                    });
                    message("Meeting status updated.", "success");
                    await loadMeetings();
                } catch (error) {
                    message(error.message, "error");
                }
            });
            panel.append(makeElement("h3", "mt-24", "Meeting status"), statusControl);
        }
    } catch (error) {
        panel.replaceChildren(makeElement("p", "message error", error.message));
    }
}

async function initMeetings() {
    const user = await loadCurrentUser();
    const canManage = privilegedRoles.includes(user.role);
    document.getElementById("showMeetingForm").classList.toggle("hidden", !canManage);
    if (canManage) loadInvitePicker();
    setMeetingTypeFields();
    document.getElementById("meetingType").addEventListener("change", setMeetingTypeFields);
    document.getElementById("meetingForm").addEventListener("submit", createMeeting);
    document.getElementById("statusFilter").addEventListener("change", () => {
        state.meetingPage = 1;
        loadMeetings();
    });
    document.getElementById("previousMeetingsPage").addEventListener("click", () => {
        state.meetingPage -= 1;
        loadMeetings();
    });
    document.getElementById("nextMeetingsPage").addEventListener("click", () => {
        state.meetingPage += 1;
        loadMeetings();
    });
    document.getElementById("inviteSearch").addEventListener("input", (event) => {
        clearTimeout(state.inviteTimer);
        state.inviteTimer = setTimeout(() => loadInvitePicker(event.target.value.trim()), 250);
    });
    document.getElementById("showMeetingForm").addEventListener("click", () => {
        document.getElementById("meetingFormPanel").classList.remove("hidden");
    });
    document.getElementById("cancelMeetingForm").addEventListener("click", () => {
        document.getElementById("meetingFormPanel").classList.add("hidden");
    });
    document.getElementById("meetingList").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-meeting-id]");
        if (button) showMeetingDetails(button.dataset.meetingId);
    });
    await loadMeetings();
}

function addMemberRow(user, isAdmin) {
    const row = document.createElement("tr");
    row.append(
        makeElement("td", "", user.fullName),
        makeElement("td", "", user.email)
    );
    const roleCell = makeElement("td");
    const statusCell = makeElement("td");
    if (isAdmin) {
        const role = document.createElement("select");
        role.className = "field-control";
        for (const value of ["admin", "chairperson", "secretary", "member"]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            option.selected = value === user.role;
            role.append(option);
        }
        role.addEventListener("change", async () => {
            try {
                await api(`/api/users/${user.id}/role`, {
                    method: "PATCH",
                    body: JSON.stringify({ role: role.value })
                });
                message(`Updated ${user.fullName}’s role.`, "success");
            } catch (error) {
                role.value = user.role;
                message(error.message, "error");
            }
        });
        const status = document.createElement("select");
        status.className = "field-control";
        for (const value of ["active", "suspended"]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            option.selected = value === user.status;
            status.append(option);
        }
        status.addEventListener("change", async () => {
            try {
                await api(`/api/users/${user.id}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: status.value })
                });
                message(`Updated ${user.fullName}’s account status.`, "success");
            } catch (error) {
                status.value = user.status;
                message(error.message, "error");
            }
        });
        roleCell.append(role);
        statusCell.append(status);
    } else {
        roleCell.textContent = user.role;
        statusCell.append(makeElement("span", `badge badge-${user.status}`, user.status));
    }
    row.append(roleCell, statusCell, makeElement("td", "", formatDate(user.createdAt)));
    if (isAdmin) row.append(makeElement("td", "muted", "Saved automatically"));
    return row;
}

async function loadMembers() {
    const search = document.getElementById("memberSearch").value.trim();
    const params = new URLSearchParams({
        page: String(state.memberPage),
        limit: "25",
        search
    });
    try {
        const result = await api(`/api/users?${params}`);
        const tbody = document.getElementById("memberRows");
        tbody.replaceChildren();
        if (!result.users.length) {
            const row = document.createElement("tr");
            row.append(makeElement("td", "muted", "No members found."));
            tbody.append(row);
        } else {
            for (const user of result.users) tbody.append(addMemberRow(user, state.user.role === "admin"));
        }
        const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.limit));
        document.getElementById("paginationInfo").textContent =
            `Page ${state.memberPage} of ${totalPages} · ${result.pagination.total} members`;
        document.getElementById("previousPage").disabled = state.memberPage <= 1;
        document.getElementById("nextPage").disabled = state.memberPage >= totalPages;
    } catch (error) {
        message(error.message, "error");
        document.getElementById("memberRows").replaceChildren();
    }
}

async function initMembers() {
    await loadCurrentUser();
    if (!privilegedRoles.includes(state.user.role)) {
        window.location.assign("/dashboard.html");
        return;
    }
    const isAdmin = state.user.role === "admin";
    document.getElementById("memberActionsHeading").classList.toggle("hidden", !isAdmin);
    document.getElementById("memberSearch").addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
            state.memberPage = 1;
            loadMembers();
        }, 250);
    });
    document.getElementById("previousPage").addEventListener("click", () => {
        state.memberPage -= 1;
        loadMembers();
    });
    document.getElementById("nextPage").addEventListener("click", () => {
        state.memberPage += 1;
        loadMembers();
    });
    await loadMembers();
}

async function loadMinutes(meetingId) {
    if (!meetingId) {
        document.getElementById("minutesPanel").classList.add("hidden");
        return;
    }
    try {
        const result = await api(`/api/meetings/${meetingId}/minutes`);
        state.selectedMeeting = Number(meetingId);
        const panel = document.getElementById("minutesPanel");
        panel.classList.remove("hidden");
        document.getElementById("minutesTitle").textContent = "Meeting minutes";
        document.getElementById("minutesContent").value = result.minutes.content;
        document.getElementById("approvalState").textContent =
            `Status: ${result.minutes.approvalStatus}`;
        document.getElementById("approveMinutes").classList.toggle(
            "hidden",
            state.user.role === "member" || result.minutes.approvalStatus === "approved"
        );
        const decisionList = document.getElementById("decisionList");
        decisionList.replaceChildren();
        for (const decision of result.decisions) {
            decisionList.append(makeElement("p", "list-item", decision.text));
        }
        if (!result.decisions.length) decisionList.append(makeElement("p", "empty-state", "No decisions recorded."));
        const actionList = document.getElementById("actionList");
        actionList.replaceChildren();
        for (const action of result.actionItems) {
            const row = makeElement("div", "list-item");
            row.append(makeElement(
                "p",
                "",
                `${action.description} · ${action.status}${action.assignedTo ? ` · ${action.assignedTo}` : ""}${action.dueDate ? ` · due ${action.dueDate}` : ""}`
            ));
            const status = document.createElement("select");
            status.className = "field-control";
            for (const value of ["pending", "in_progress", "completed"]) {
                const option = new Option(value.replace("_", " "), value, false, value === action.status);
                status.append(option);
            }
            status.addEventListener("change", async () => {
                try {
                    await api(`/api/meetings/${state.selectedMeeting}/action-items/${action.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: status.value })
                    });
                    message("Action item updated.", "success");
                    await loadMinutes(state.selectedMeeting);
                } catch (error) {
                    message(error.message, "error");
                    status.value = action.status;
                }
            });
            row.append(status);
            actionList.append(row);
        }
        if (!result.actionItems.length) actionList.append(makeElement("p", "empty-state", "No action items recorded."));
    } catch (error) {
        message(error.message, "error");
    }
}

async function initMinutes() {
    const user = await loadCurrentUser();
    const canManage = privilegedRoles.includes(user.role);
    const result = await api("/api/meetings?limit=100");
    const select = document.getElementById("minutesMeeting");
    select.replaceChildren(new Option("Select a meeting", ""));
    for (const meeting of result.meetings) {
        select.append(new Option(`${meeting.title} · ${meeting.status}`, meeting.id));
    }
    select.addEventListener("change", () => loadMinutes(select.value));
    document.getElementById("decisionForm").classList.toggle("hidden", !canManage);
    document.getElementById("actionForm").classList.toggle("hidden", !canManage);
    if (canManage) {
        const members = await api("/api/users?limit=100");
        const assignee = document.getElementById("actionAssignee");
        for (const member of members.users) {
            if (member.status === "active") {
                assignee.append(new Option(member.fullName, member.id));
            }
        }
    }

    document.getElementById("decisionForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.selectedMeeting) return;
        try {
            await api(`/api/meetings/${state.selectedMeeting}/decisions`, {
                method: "POST",
                body: JSON.stringify({ text: document.getElementById("decisionInput").value })
            });
            document.getElementById("decisionInput").value = "";
            message("Decision recorded.", "success");
            await loadMinutes(state.selectedMeeting);
        } catch (error) {
            message(error.message, "error");
        }
    });

    document.getElementById("actionForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.selectedMeeting) return;
        try {
            await api(`/api/meetings/${state.selectedMeeting}/action-items`, {
                method: "POST",
                body: JSON.stringify({
                    description: document.getElementById("actionDescription").value,
                    assignedTo: document.getElementById("actionAssignee").value || null,
                    dueDate: document.getElementById("actionDueDate").value || null
                })
            });
            event.currentTarget.reset();
            message("Action item added.", "success");
            await loadMinutes(state.selectedMeeting);
        } catch (error) {
            message(error.message, "error");
        }
    });
    document.getElementById("saveMinutes").addEventListener("click", async () => {
        if (!state.selectedMeeting) return;
        try {
            await api(`/api/meetings/${state.selectedMeeting}/minutes`, {
                method: "PUT",
                body: JSON.stringify({
                    content: document.getElementById("minutesContent").value,
                    approvalStatus: "draft"
                })
            });
            message("Minutes saved as a draft.", "success");
            await loadMinutes(state.selectedMeeting);
        } catch (error) {
            message(error.message, "error");
        }
    });
    document.getElementById("approveMinutes").addEventListener("click", async () => {
        if (!state.selectedMeeting) return;
        try {
            await api(`/api/meetings/${state.selectedMeeting}/minutes`, {
                method: "PUT",
                body: JSON.stringify({
                    content: document.getElementById("minutesContent").value,
                    approvalStatus: "approved"
                })
            });
            message("Minutes approved.", "success");
            await loadMinutes(state.selectedMeeting);
        } catch (error) {
            message(error.message, "error");
        }
    });
    document.getElementById("printMinutes").addEventListener("click", () => window.print());
    if (!canManage) {
        document.getElementById("saveMinutes").classList.add("hidden");
    }
}

async function init() {
    try {
        if (page === "meetings") await initMeetings();
        if (page === "members") await initMembers();
        if (page === "minutes") await initMinutes();
    } catch (error) {
        message(error.message, "error");
    }
}

init();
