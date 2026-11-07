"use strict";

const express = require("express");
const db = require("../config/database");
const { requireAuth, requireRoles } = require("../middleware/auth");

const router = express.Router();
const managerRoles = ["admin", "chairperson", "secretary"];

function parseId(value) {
    if (
        (typeof value !== "string" && typeof value !== "number")
        || !/^\d+$/.test(String(value))
    ) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function canAccessMeeting(meetingId, user) {
    const result = await db.query(
        `SELECT id, title, description, meeting_type AS "meetingType",
                start_time AS "startTime", end_time AS "endTime", status,
                chairperson_id AS "chairpersonId",
                secretary_id AS "secretaryId",
                created_by AS "createdBy"
         FROM meetings m
         WHERE m.id = $1
           AND (
               $2 = 'admin'
               OR m.created_by = $3
               OR m.chairperson_id = $3
               OR m.secretary_id = $3
               OR EXISTS (
                   SELECT 1 FROM meeting_members mm
                   WHERE mm.meeting_id = m.id AND mm.user_id = $3
               )
           )`,
        [meetingId, user.role, user.id]
    );
    return result.rows[0] || null;
}

router.get("/", requireAuth, async (req, res, next) => {
    const requestedPage = Number.parseInt(req.query.page, 10);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, 1000000)
        : 1;
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const allowedStatuses = ["scheduled", "in_progress", "completed", "cancelled"];

    if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Invalid meeting status filter."
        });
    }

    try {
        const [meetings, total] = await Promise.all([
            db.query(
            `SELECT m.id, m.title, m.description,
                    m.meeting_type AS "meetingType",
                    m.start_time AS "startTime", m.end_time AS "endTime",
                    m.status, m.created_at AS "createdAt",
                    (SELECT COUNT(*) FROM meeting_members mm
                     WHERE mm.meeting_id = m.id)::INTEGER AS "participantCount"
             FROM meetings m
             WHERE ($1 = '' OR m.status = $1)
               AND (
                   $2 = 'admin'
                   OR m.created_by = $3
                   OR m.chairperson_id = $3
                   OR m.secretary_id = $3
                   OR EXISTS (
                       SELECT 1 FROM meeting_members mm
                       WHERE mm.meeting_id = m.id AND mm.user_id = $3
                   )
               )
             ORDER BY
                 CASE WHEN m.status IN ('scheduled', 'in_progress') THEN 0 ELSE 1 END,
                 m.start_time ASC NULLS LAST,
                 m.created_at DESC
             LIMIT $4 OFFSET $5`,
            [status, req.user.role, req.user.id, limit, offset]
            ),
            db.query(
                `SELECT COUNT(*)::INTEGER AS total
                 FROM meetings m
                 WHERE ($1 = '' OR m.status = $1)
                   AND (
                       $2 = 'admin'
                       OR m.created_by = $3
                       OR m.chairperson_id = $3
                       OR m.secretary_id = $3
                       OR EXISTS (
                           SELECT 1 FROM meeting_members mm
                           WHERE mm.meeting_id = m.id AND mm.user_id = $3
                       )
                   )`,
                [status, req.user.role, req.user.id]
            )
        ]);
        res.json({
            success: true,
            serverTime: new Date().toISOString(),
            meetings: meetings.rows,
            pagination: { page, limit, total: total.rows[0].total }
        });
    } catch (error) {
        next(error);
    }
});

router.post("/", requireRoles(...managerRoles), async (req, res, next) => {
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const description = typeof req.body.description === "string"
        ? req.body.description.trim()
        : "";
    const meetingType = req.body.meetingType;
    const startTime = req.body.startTime || null;
    const endTime = req.body.endTime || null;
    if (req.body.agenda !== undefined && !Array.isArray(req.body.agenda)) {
        return res.status(400).json({
            success: false,
            message: "Agenda items must be provided as a list."
        });
    }
    const agenda = Array.isArray(req.body.agenda) ? req.body.agenda : [];
    if (req.body.participantIds !== undefined && !Array.isArray(req.body.participantIds)) {
        return res.status(400).json({
            success: false,
            message: "Invited member IDs must be provided as a list."
        });
    }
    const participantIds = Array.isArray(req.body.participantIds)
        ? req.body.participantIds.map(parseId)
        : [];
    if (participantIds.includes(null)) {
        return res.status(400).json({
            success: false,
            message: "Every invited member ID must be a positive integer."
        });
    }
    const uniqueParticipantIds = [...new Set(participantIds)];
    const rawChairpersonId = req.body.chairpersonId;
    const rawSecretaryId = req.body.secretaryId;
    const chairpersonId = parseId(rawChairpersonId)
        || (req.user.role === "chairperson" ? Number(req.user.id) : null);
    const secretaryId = parseId(rawSecretaryId)
        || (req.user.role === "secretary" ? Number(req.user.id) : null);
    if (
        (rawChairpersonId && !parseId(rawChairpersonId))
        || (rawSecretaryId && !parseId(rawSecretaryId))
    ) {
        return res.status(400).json({
            success: false,
            message: "Chairperson and secretary IDs must be positive integers."
        });
    }

    if (title.length < 3 || title.length > 200) {
        return res.status(400).json({
            success: false,
            message: "Meeting title must be between 3 and 200 characters."
        });
    }
    if (description.length > 5000) {
        return res.status(400).json({
            success: false,
            message: "Meeting description cannot exceed 5,000 characters."
        });
    }
    if (!["timed", "untimed"].includes(meetingType)) {
        return res.status(400).json({
            success: false,
            message: "Choose a timed or untimed meeting."
        });
    }
    if (meetingType === "timed") {
        if (typeof startTime !== "string" || typeof endTime !== "string") {
            return res.status(400).json({
                success: false,
                message: "Timed meetings require valid start and end times."
            });
        }
        const start = Date.parse(startTime);
        const end = Date.parse(endTime);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid start time and an end time after it for timed meetings."
            });
        }
    }
    if (agenda.length > 100 || agenda.some((item) =>
        typeof item !== "string" || item.trim().length < 1 || item.trim().length > 250
    )) {
        return res.status(400).json({
            success: false,
            message: "Agenda items must be text no longer than 250 characters (up to 100 items)."
        });
    }
    if (uniqueParticipantIds.length > 1000) {
        return res.status(400).json({
            success: false,
            message: "A meeting can have at most 1,000 invited participants."
        });
    }

    try {
        if (chairpersonId) {
            const person = await db.query(
                `SELECT id FROM users
                 WHERE id = $1 AND role = 'chairperson' AND status = 'active'`,
                [chairpersonId]
            );
            if (!person.rowCount) {
                return res.status(400).json({
                    success: false,
                    message: "The selected chairperson must have an active chairperson account."
                });
            }
        }
        if (secretaryId) {
            const person = await db.query(
                `SELECT id FROM users
                 WHERE id = $1 AND role = 'secretary' AND status = 'active'`,
                [secretaryId]
            );
            if (!person.rowCount) {
                return res.status(400).json({
                    success: false,
                    message: "The selected secretary must have an active secretary account."
                });
            }
        }
        if (uniqueParticipantIds.length) {
            const activeMembers = await db.query(
                `SELECT COUNT(*)::INTEGER AS total
                 FROM users WHERE id = ANY($1::BIGINT[]) AND status = 'active'`,
                [uniqueParticipantIds]
            );
            if (activeMembers.rows[0].total !== uniqueParticipantIds.length) {
                return res.status(400).json({
                    success: false,
                    message: "One or more invited members do not exist or are inactive."
                });
            }
        }

        const result = await db.withTransaction(async (client) => {
            const meeting = await client.query(
                `INSERT INTO meetings (
                    title, description, meeting_type, start_time, end_time,
                    chairperson_id, secretary_id, created_by
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id, title, description,
                           meeting_type AS "meetingType",
                           start_time AS "startTime", end_time AS "endTime",
                           status`,
                [
                    title,
                    description,
                    meetingType,
                    meetingType === "timed" ? startTime : null,
                    meetingType === "timed" ? endTime : null,
                    chairpersonId,
                    secretaryId,
                    req.user.id
                ]
            );
            const meetingId = meeting.rows[0].id;
            const inviteeIds = [...new Set([
                ...uniqueParticipantIds,
                chairpersonId,
                secretaryId
            ].filter(Boolean))];
            const members = [...new Set([Number(req.user.id), ...inviteeIds])];
            await client.query(
                `INSERT INTO meeting_members (meeting_id, user_id, invited_by, invitation_status)
                 SELECT $1, id, $3, CASE WHEN id = $3 THEN 'accepted' ELSE 'invited' END
                 FROM users
                 WHERE id = ANY($2::BIGINT[]) AND status = 'active'
                 ON CONFLICT (meeting_id, user_id) DO NOTHING`,
                [meetingId, members, req.user.id]
            );
            if (inviteeIds.length) {
                await client.query(
                    `INSERT INTO notifications (user_id, message)
                     SELECT id, $2 FROM users
                     WHERE id = ANY($1::BIGINT[]) AND id <> $3`,
                    [inviteeIds, `You are invited to “${title}”.`, req.user.id]
                );
            }
            await client.query(
                `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
                 VALUES ($1, 'meeting.created', 'meeting', $2)`,
                [req.user.id, meetingId]
            );
            for (const [position, item] of agenda.entries()) {
                await client.query(
                    `INSERT INTO agenda_items (meeting_id, title, position)
                     VALUES ($1, $2, $3)`,
                    [meetingId, item.trim(), position]
                );
            }
            return meeting.rows[0];
        });

        res.status(201).json({ success: true, meeting: result });
    } catch (error) {
        next(error);
    }
});

router.get("/summary", requireAuth, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT COUNT(*)::INTEGER AS total,
                    COUNT(*) FILTER (WHERE m.status = 'scheduled')::INTEGER AS scheduled,
                    COUNT(*) FILTER (WHERE m.status = 'in_progress')::INTEGER AS in_progress
             FROM meetings m
             WHERE (
                 $1 = 'admin'
                 OR m.created_by = $2
                 OR m.chairperson_id = $2
                 OR m.secretary_id = $2
                 OR EXISTS (
                     SELECT 1 FROM meeting_members mm
                     WHERE mm.meeting_id = m.id AND mm.user_id = $2
                 )
             )`,
            [req.user.role, req.user.id]
        );
        res.json({
            success: true,
            meetings: {
                total: result.rows[0].total,
                upcoming: result.rows[0].scheduled + result.rows[0].in_progress
            }
        });
    } catch (error) {
        next(error);
    }
});

router.get("/:id", requireAuth, async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ success: false, message: "Invalid meeting ID." });
    }

    try {
        const meeting = await canAccessMeeting(meetingId, req.user);
        if (!meeting) {
            return res.status(404).json({
                success: false,
                message: "Meeting not found."
            });
        }
        const [agenda, members, attendance, minutes] = await Promise.all([
            db.query(
                `SELECT id, title, details, position
                 FROM agenda_items WHERE meeting_id = $1 ORDER BY position, id`,
                [meetingId]
            ),
            db.query(
                `SELECT u.id, u.full_name AS "fullName", u.email, u.role,
                        mm.invitation_status AS "invitationStatus"
                 FROM meeting_members mm
                 JOIN users u ON u.id = mm.user_id
                 WHERE mm.meeting_id = $1
                 ORDER BY u.full_name`,
                [meetingId]
            ),
            db.query(
                `SELECT u.id, u.full_name AS "fullName",
                        a.attendance_status AS status, a.joined_at AS "joinedAt"
                 FROM attendance a
                 JOIN users u ON u.id = a.user_id
                 WHERE a.meeting_id = $1
                 ORDER BY a.joined_at`,
                [meetingId]
            ),
            db.query(
                `SELECT approval_status AS "approvalStatus", updated_at AS "updatedAt"
                 FROM minutes WHERE meeting_id = $1`,
                [meetingId]
            )
        ]);
        res.json({
            success: true,
            meeting: {
                ...meeting,
                agenda: agenda.rows,
                members: members.rows,
                attendance: attendance.rows,
                minutes: minutes.rows[0] || null
            }
        });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/status", requireRoles(...managerRoles), async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    const status = req.body.status;
    if (!meetingId || !["scheduled", "in_progress", "completed", "cancelled"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid meeting status." });
    }

    try {
        const meeting = await canAccessMeeting(meetingId, req.user);
        if (!meeting) {
            return res.status(404).json({ success: false, message: "Meeting not found." });
        }
        if (
            req.user.role !== "admin"
            && Number(meeting.createdBy) !== Number(req.user.id)
            && Number(meeting.chairpersonId) !== Number(req.user.id)
        ) {
            return res.status(403).json({
                success: false,
                message: "Only the administrator or meeting chairperson can change its status."
            });
        }
        const result = await db.query(
            `UPDATE meetings SET status = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id, status`,
            [status, meetingId]
        );
        res.json({ success: true, meeting: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

router.post("/:id/attendance", requireAuth, async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ success: false, message: "Invalid meeting ID." });
    }
    try {
        const meeting = await canAccessMeeting(meetingId, req.user);
        if (!meeting) {
            return res.status(404).json({ success: false, message: "Meeting not found." });
        }
        const attendance = await db.query(
            `INSERT INTO attendance (meeting_id, user_id, attendance_status)
             VALUES ($1, $2, 'present')
             ON CONFLICT (meeting_id, user_id)
             DO UPDATE SET attendance_status = 'present'
             RETURNING meeting_id AS "meetingId", user_id AS "userId",
                       attendance_status AS status, joined_at AS "joinedAt"`,
            [meetingId, req.user.id]
        );
        res.status(201).json({ success: true, attendance: attendance.rows[0] });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/invitation", requireAuth, async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    const invitationStatus = req.body.invitationStatus;
    if (!meetingId || !["accepted", "declined"].includes(invitationStatus)) {
        return res.status(400).json({
            success: false,
            message: "Choose accepted or declined for a valid meeting invitation."
        });
    }
    try {
        const result = await db.query(
            `UPDATE meeting_members
             SET invitation_status = $1
             WHERE meeting_id = $2 AND user_id = $3
             RETURNING meeting_id AS "meetingId", invitation_status AS status`,
            [invitationStatus, meetingId, req.user.id]
        );
        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                message: "Invitation not found."
            });
        }
        res.json({ success: true, invitation: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

router.get("/:id/minutes", requireAuth, async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ success: false, message: "Invalid meeting ID." });
    }
    try {
        if (!await canAccessMeeting(meetingId, req.user)) {
            return res.status(404).json({ success: false, message: "Meeting not found." });
        }
        const [minutes, decisions, actionItems, transcripts] = await Promise.all([
            db.query(
                `SELECT id, meeting_id AS "meetingId", content,
                        approval_status AS "approvalStatus",
                        approved_by AS "approvedBy", approved_at AS "approvedAt",
                        updated_at AS "updatedAt"
                 FROM minutes WHERE meeting_id = $1`,
                [meetingId]
            ),
            db.query(
                `SELECT id, decision_text AS text, created_at AS "createdAt"
                 FROM decisions WHERE meeting_id = $1 ORDER BY id`,
                [meetingId]
            ),
            db.query(
                `SELECT ai.id, ai.task_description AS description, ai.due_date AS "dueDate",
                        ai.status, ai.assigned_to AS "assignedToId",
                        u.full_name AS "assignedTo"
                 FROM action_items ai
                 LEFT JOIN users u ON u.id = ai.assigned_to
                 WHERE ai.meeting_id = $1 ORDER BY ai.id`,
                [meetingId]
            ),
            db.query(
                `SELECT id, content, created_at AS "createdAt"
                 FROM transcripts WHERE meeting_id = $1 ORDER BY id DESC LIMIT 20`,
                [meetingId]
            )
        ]);
        res.json({
            success: true,
            minutes: minutes.rows[0] || {
                meetingId,
                content: "",
                approvalStatus: "draft"
            },
            decisions: decisions.rows,
            actionItems: actionItems.rows,
            transcripts: transcripts.rows
        });
    } catch (error) {
        next(error);
    }
});

router.put("/:id/minutes", requireRoles(...managerRoles), async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    const content = typeof req.body.content === "string" ? req.body.content : "";
    const approvalStatus = req.body.approvalStatus === "approved" ? "approved" : "draft";
    if (!meetingId || content.length > 100000) {
        return res.status(400).json({
            success: false,
            message: "Invalid meeting ID or minutes exceed the 100,000 character limit."
        });

    }
    try {
        if (!await canAccessMeeting(meetingId, req.user)) {
            return res.status(404).json({ success: false, message: "Meeting not found." });
        }
        const minutes = await db.query(
            `INSERT INTO minutes (
                meeting_id, content, approval_status, approved_by, approved_at, updated_at
             )
             VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'approved' THEN NOW() END, NOW())
             ON CONFLICT (meeting_id)
             DO UPDATE SET content = EXCLUDED.content,
                           approval_status = EXCLUDED.approval_status,
                           approved_by = EXCLUDED.approved_by,
                           approved_at = EXCLUDED.approved_at,
                           updated_at = NOW()
             RETURNING id, meeting_id AS "meetingId", content,
                       approval_status AS "approvalStatus",
                       approved_by AS "approvedBy", approved_at AS "approvedAt",
                       updated_at AS "updatedAt"`,
            [
                meetingId,
                content,
                approvalStatus,
                approvalStatus === "approved" ? req.user.id : null
            ]
        );
        res.json({ success: true, minutes: minutes.rows[0] });
    } catch (error) {
        next(error);
    }
});

router.post("/:id/decisions", requireRoles(...managerRoles), async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!meetingId || text.length < 2 || text.length > 5000) {
        return res.status(400).json({
            success: false,
            message: "Decision text must be between 2 and 5,000 characters."
        });
    }

    try {
        if (!await canAccessMeeting(meetingId, req.user)) {
            return res.status(404).json({ success: false, message: "Meeting not found." });
        }
        const result = await db.query(
            `INSERT INTO decisions (meeting_id, decision_text, created_by)
             VALUES ($1, $2, $3)
             RETURNING id, decision_text AS text, created_at AS "createdAt"`,
            [meetingId, text, req.user.id]
        );
        res.status(201).json({ success: true, decision: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

router.post("/:id/action-items", requireRoles(...managerRoles), async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    const description = typeof req.body.description === "string"
        ? req.body.description.trim()
        : "";
    const assignedTo = req.body.assignedTo ? parseId(req.body.assignedTo) : null;
    const dueDate = req.body.dueDate || null;
    if (
        !meetingId
        || description.length < 2
        || description.length > 2000
        || (req.body.assignedTo && !assignedTo)
        || (dueDate && !isDateOnly(dueDate))
    ) {
        return res.status(400).json({
            success: false,
            message: "Enter a valid action description, assignee and due date."
        });
    }

    try {
        if (!await canAccessMeeting(meetingId, req.user)) {
            return res.status(404).json({ success: false, message: "Meeting not found." });
        }
        if (assignedTo) {
            const assignee = await db.query(
                `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
                [assignedTo]
            );
            if (!assignee.rowCount) {
                return res.status(400).json({
                    success: false,
                    message: "The action item assignee is not an active member."
                });
            }
        }

        const actionItem = await db.withTransaction(async (client) => {
            const result = await client.query(
                `INSERT INTO action_items (meeting_id, assigned_to, task_description, due_date)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, task_description AS description, due_date AS "dueDate", status`,
                [meetingId, assignedTo, description, dueDate]
            );
            if (assignedTo) {
                await client.query(
                    `INSERT INTO notifications (user_id, message)
                     VALUES ($1, $2)`,
                    [assignedTo, `A meeting action item was assigned to you: ${description}`]
                );
            }
            return result.rows[0];
        });
        res.status(201).json({ success: true, actionItem });
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/action-items/:actionItemId", requireAuth, async (req, res, next) => {
    const meetingId = parseId(req.params.id);
    const actionItemId = parseId(req.params.actionItemId);
    const status = req.body.status;
    if (
        !meetingId
        || !actionItemId
        || !["pending", "in_progress", "completed"].includes(status)
    ) {
        return res.status(400).json({ success: false, message: "Invalid action-item update." });
    }

    try {
        if (!await canAccessMeeting(meetingId, req.user)) {
            return res.status(404).json({ success: false, message: "Meeting not found." });
        }
        const isManager = managerRoles.includes(req.user.role);
        const result = await db.query(
            `UPDATE action_items
             SET status = $1
             WHERE id = $2 AND meeting_id = $3
               AND ($4::BOOLEAN OR assigned_to = $5)
             RETURNING id, task_description AS description, status`,
            [status, actionItemId, meetingId, isManager, req.user.id]
        );
        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                message: "Action item not found or you are not its assignee."
            });
        }
        res.json({ success: true, actionItem: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
