# Version history

## v0.13.0 (Phase 13, fees, invoices and dues)
- Features: fee kinds per university (fixed, per credit, per course, per lab course; charged at admission or every semester); fee amounts for the whole university or per program (a program's amount replaces the default for that fee); credit-wise tuition (registered credits x rate) with lab and per-course fees from the student's actual registration; scholarships, discounts and waivers (percent or fixed, for all charges or one fee, for one semester or until revoked); invoices (admission, semester) created one by one or in bulk for every registered student of a semester; adjustments; installment plans; one-time late fee after a grace period; payments received at the cashier or bank (cash, bank transfer, cheque) with receipts; student "My fees" page; finance overview (billed, collected, outstanding, overdue, by method); optional fee clearance for admit cards.
- Formula: total payable = sum of the invoice lines, where charges (tuition, credit fee, other fees, late fee) are positive and discounts, waivers and negative adjustments are negative. Concessions are worked out on the original charge (never on each other) and can never push a charge below zero.
- Integrity and security: all money is handled in integer cents; an invoice's total, paid amount and next due date are rewritten in the same transaction as every change; the database allows only one live admission invoice and one live invoice per semester for a student, even under concurrent requests; a payment can never exceed the balance; repeating a payment submission with the same key returns the first payment instead of charging twice; only payments with status 'succeeded' count; invoices with payments cannot be cancelled or recalculated (use adjustments); a negative adjustment cannot take the total below what was paid; existing invoices are never changed by later fee-structure edits; permissions are split between finance.view, finance.manage and finance.collect; students see only their own invoices; every change is audited with old and new values.
- Receipts are a new document type (serial PR-year-number, verification code, revocation) built on the documents module; a payment confirmation email is sent.
- Database: migration 013 adds `fee_heads`, `fee_schedule_items`, `student_concessions`, `fee_settings`, `invoices`, `invoice_lines`, `invoice_installments`, `payments`, and adds payment_receipt to `issued_documents.doc_type`; permissions finance.view, finance.manage, finance.collect.
- API: /finance (me, settings, fee-heads, fee-schedule, students/:id, invoices, invoices/generate-semester, invoices/:id and its recalculate/adjustments/installments/cancel/payments, late-fees/assess, payments, summary); /documents/me/receipts and /documents/students/:id/receipts.
- Breaking changes: none.

## v0.12.0 (Phase 12, documents)
- Features: transcript, semester result, admit card and enrollment confirmation as print-ready A4 pages (browser Print, or "Save as PDF" from the print window; also downloadable as an HTML file); every document gets a serial number and a 12-character verification code; a public page verifies a document from its serial and code; staff can issue official documents for any student and revoke them; students get their own documents (their transcript is marked as a student copy).
- Rules: the transcript and semester result use published results only, with the university's own grading scale printed as a legend; the semester result shows the cumulative CGPA up to that semester; an admit card needs a confirmed registration and refuses courses where attendance is below the university minimum; an admit card can be issued despite failed checks only with documents.override and a written reason, which is printed on the card and audited; further conditions (such as fee clearance) can be added by later modules through registerAdmitCardCheck.
- Integrity and security: the content as issued is stored, so a document re-prints exactly as issued even if data changes later; identical requests within 24 hours return the same document instead of creating duplicates; all text is escaped and the page has a strict policy with no script; verification gives the same answer for an unknown serial and a wrong code, compares codes in constant time, is rate limited and reveals nothing without the printed code; a revoked document is marked invalid on the printout and in verification; students can only open their own documents; every issue and revocation is audited.
- Database: migration 012 adds `issued_documents`; permissions documents.view, documents.issue, documents.manage, documents.override.
- API: /documents (list, me, me/options, me/generate, students/:id and students/:id/generate, /:id, /:id/print, /:id/revoke) and public /verify/:serial?code=.
- Breaking changes: none.

## v0.11.0 (Phase 11, results)
- Features: configurable grading scale per university (with the standard Bangladesh 4.00 scale offered as a starting point); assessment parts per section (for example Quiz, Midterm, Final); marks entry sheet; automatic percentage, letter grade, grade point; semester GPA and CGPA; a three-step flow (draft, submitted, published); corrections to published results through a request and approval workflow; full version history of every published result; student "My results" page.
- Rules: percentage = total marks divided by the sum of the maximums; a mark must be 0 to the part's maximum with up to 2 decimals; a grade is the one with the highest starting percentage the mark reaches (rounded to 2 decimals); GPA is credit-weighted; for a retaken course only the latest attempt counts in the CGPA and its credits count once.
- Integrity and security: submitting requires a complete mark for every enrolled student and an existing grading scale; submitted or published marks are locked; the person who submitted results cannot publish them, and the person who requested a correction cannot approve it; one pending correction per result (database-enforced); an approved correction re-checks that the marks did not change in the meantime; grades and points are stored with each result so changing the scale never rewrites published results; students see only published results; every step is audited with old and new values.
- Publication sets `enrollments.outcome` to passed or failed, which is what unlocks prerequisite checks in enrollment.
- Database: migration 011 adds `grade_scale_entries`, `assessment_components`, `marks`, `result_batches`, `results`, `result_history`, `result_corrections`; permissions results.view, results.manage, results.publish, results.approve.
- API: /results/sections (list), /results/sections/:id/{sheet,components,marks,submit,reopen,publish}, /results/entries/:id/{corrections,history}, /results/corrections (+ approve, reject), /results/grade-scale (+ default), /results/me, /results/students/:id.
- Breaking changes: none.

## v0.10.0 (Phase 10, attendance)
- Features: a section's teacher records classes (date, class number, topic) and marks each enrolled student present, late, absent or excused; per-section summary; per-student view by course with day-by-day detail; attendance report with a "below minimum" filter; minimum attendance percentage per university (default 75).
- Rules: late counts as attended; excused classes are left out of the percentage; a class cannot be dated in the future or outside the semester; only students currently enrolled in the section can be marked; a student who joins later is not counted absent for earlier classes; a teacher can create or correct classes only from the last ATTENDANCE_EDIT_DAYS days (default 7), while attendance.manage has no such limit.
- Security: access is decided on the server per section (the section's own teacher, attendance.manage, or read-only attendance.view); students see only their own attendance; every marking and deletion is audited with counts of changes and corrections; tenant scoped.
- Database: migration 010 adds `attendance_sessions` and `attendance_records`; permissions attendance.view and attendance.manage.
- API: /attendance/sections/:id/{sessions,summary}, /attendance/sessions/:id (GET, DELETE) and PUT /records, /attendance/me and /me/sections/:id, /attendance/students/:id, /attendance/report, /attendance/policy.
- New env var: ATTENDANCE_EDIT_DAYS.
- Breaking changes: none.

## v0.9.0 (Phase 09, enrollment)
- Features: semester registration with dates (registration window and add/drop deadline per semester); course and section selection; add, drop and whole-registration cancel; confirmation email; registration history; staff can act for a student; section rosters (for staff with enrollment.view and for the section's own teacher); "prior credits" so transfer, exempted and older completed courses count for prerequisites.
- Rules enforced on the server for every request: account active and student studying; registration dates (time zone configurable); section open and offered in that semester; course in the student's program curriculum; prerequisites met; not already completed or registered; minimum and maximum credit rule; no timetable clash with the student's other sections; seat available.
- Security and integrity: sections are row-locked (in id order) while seats are counted so the last seat cannot be sold twice; a database unique key stops two active enrollments in one course; the whole registration is one transaction (all courses or none); overriding the dates needs the separate permission enrollment.override and is recorded in the audit log; dropping cannot go below the minimum credits or remove the last course (cancel instead); dropped records are kept as history.
- Database: migration 009 adds registration_start, registration_end, add_drop_end to `semesters`, and tables `registrations`, `enrollments`, `prior_credits`; permissions enrollment.view, enrollment.manage, enrollment.override.
- API: /enrollment/me/{overview,history,register,add,drop,cancel}; /enrollment/students/:studentId/{overview,history,register,add,drop,cancel,prior-credits}; /enrollment/registrations; /enrollment/sections/:sectionId/roster.
- New env var: APP_TIMEZONE (default Asia/Dhaka).
- Breaking changes: none. Existing semesters have no registration dates, so registration stays closed ("not configured") until an admin sets them.

## v0.8.0 (Phase 08, sections, schedule, rooms, academic calendar)
- Features: class sections (a course offered in a semester, with seats, teacher, shift, status); weekly schedule slots with rooms; clash detection for rooms and teachers within a semester; weekly timetable view; teacher's own classes endpoint; rooms; academic calendar events (holidays, exams, registration, one-day events).
- Security: all data tenant scoped; a teacher must be an active teacher account of the same university; rooms, courses, shifts and semesters must belong to the same university; cancelled sections never block rooms or teachers; permissions sections.view/manage and calendar.view/manage (view granted to teacher, staff and student by default).
- Database: migration 008 adds `rooms`, `sections`, `section_slots`, `calendar_events`.
- API: /sections (GET, POST, GET/PATCH/DELETE /:id, PUT /:id/slots, GET /teachers, GET /timetable, GET /teaching); /structure/rooms and /structure/calendar-events through the generic engine.
- Breaking changes: none.

## v0.7.0 (Phase 07, courses, prerequisites and credit rules)
- Features: courses (code, title, decimal credit, type, department, status); program curricula (which courses, in which semester, mandatory or elective); prerequisites with loop detection; credit rules (minimum and maximum credits per semester, total for the degree) per program or as a university default; a pure eligibility engine (prerequisites, credit load, duplicates, inactive, not in curriculum, already completed) and a dry-run endpoint that enrollment will reuse; curriculum health warnings; student "My courses" view.
- Security: all course data is tenant scoped; programs and courses from other universities answer "not found"; prerequisites and curriculum rows must belong to the same university; courses use their own permissions (courses.view for teacher, staff and student by default; courses.manage explicit).
- Database: migration 007 adds `courses`, `program_courses`, `course_prerequisites`, `credit_rules` (generated scope key makes the university default unique); permissions courses.view and courses.manage.
- API: /structure/courses (CRUD via the generic engine, now with decimal fields, enum filters and per-resource permissions); /courses/:id, PUT /courses/:id/prerequisites, GET and PUT /courses/curriculum/:programId, GET and PUT /courses/credit-rules, DELETE /courses/credit-rules/:id, POST /courses/validate-selection, GET /courses/my.
- Breaking changes: none.

## v0.6.0 (Phase 06, email/SMS, first-time verification, password reset)
- Features: email and SMS services behind provider interfaces (SMTP; BulkSMSBD gateway; development "log" providers); first-time verification for new accounts (correct temporary password, then a one-time code by email or SMS, then a new password); forgot and reset password by code; welcome and password-changed emails; outbox log of every message.
- Security: codes are 6 digits, single use, 10 minutes, 5 attempts, 3 sends per 15 minutes, stored only as HMAC; the verification token uses a separate secret and cannot act as an access token; forgot-password answers identically whether or not the account exists; weak passwords never consume a valid code; blocked or inactive accounts cannot reset; reset and verification sign out all other sessions; the welcome email never contains a password; production refuses to start with log providers; a failed send is reported as failed, never as sent.
- Database: migration 006 adds `verification_codes` and `message_log` (message bodies are not stored).
- API: POST /auth/verification/send, /auth/verification/complete, /auth/password/forgot, /auth/password/reset. POST /auth/login can now return `verificationRequired` instead of a session.
- New env vars: APP_URL, EMAIL_PROVIDER, SMTP_*, EMAIL_FROM, SMS_PROVIDER, SMS_API_URL, SMS_API_KEY, SMS_SENDER_ID, VERIFICATION_*. New dependency: nodemailer.
- Breaking changes: login for pending_verification accounts now returns 200 with verificationRequired (previously 403).

## v0.5.0 (Phase 05, student registration and profiles)
- Features: administrators register students (account plus full profile in one step), student list with search and filters, student record view and edit, block/unblock/activate/deactivate, admin password reset, soft delete; students view their own profile and edit only contact fields.
- Security: duplicate student ID, email and phone are rejected (friendly check plus database unique keys); every academic reference must belong to the same university and fit together (program in department, batch in program, semester in academic year); new students start as pending_verification with a forced password change; national ID is excluded from lists; students cannot edit identity or academic fields; all changes audited with old and new values.
- Database: migration 005 adds `students`; permissions students.view, create, update, status, delete.
- API: /students (GET, POST, GET/PATCH/DELETE /:id, POST /:id/status, POST /:id/reset-password, GET/PATCH /me).
- Breaking changes: none.

## v0.4.0 (Phase 04, university structure)
- Features: universities (multi-university tenants), campuses, faculties, departments, programs, batches, academic years, semesters, shifts; a current academic year and semester per university; one screen to manage all of them.
- Security: every structure table carries university_id; parent records must belong to the same university (cross-tenant links are rejected); a university-scoped user can only see and change their own university; only the platform Super Admin creates or deactivates universities; an inactive university blocks sign-in for its users; teacher and staff accounts must now belong to a university.
- Database: migration 004 adds columns to `universities` and tables `campuses`, `faculties`, `departments`, `programs`, `batches`, `academic_years`, `semesters`, `shifts`; permissions `structure.view` (default for teacher and staff) and `structure.manage`.
- API: /universities (GET, POST, GET/:id, PATCH/:id, POST/:id/status); /structure/:resource (GET, POST, GET/PATCH/DELETE /:id, POST /:id/set-current).
- Breaking changes: none.

## v0.3.0 (Phase 03, permissions and user management)
- Features: permission catalog, role defaults, per-user grant/deny overrides, user list with search/filter/pagination, create teacher/staff/Super Admin accounts, edit details, block/unblock/activate/deactivate, admin password reset, roles and permissions screen.
- Security: server-side permission checks on every user endpoint; only Super Admin can change permissions (prevents self-escalation); users cannot change their own status; last active Super Admin is protected; status changes revoke sessions; tenant scoping and Super Admin visibility rules; all changes audited with old/new values.
- Database: migration 003 adds `permissions`, `role_permissions`, `user_permissions`.
- API: /users (GET, POST, GET/:id, PATCH/:id, POST/:id/status, POST/:id/reset-password); /permissions (GET, PUT /roles/:code, GET and PUT /users/:id). /auth responses now include `permissions`.
- Breaking changes: none.

## v0.2.0 (Phase 02, authentication)
- Features: login, logout, session refresh, change password, protected routes, forced password change, Super Admin bootstrap script.
- Security: bcrypt hashing, password policy, httpOnly JWT cookies, hashed rotating refresh tokens with reuse detection, per-account lockout (5 failures, 15 min), per-IP rate limit, CSRF origin guard, blocked accounts stop working on the next request, audit logging of auth events.
- Database: migration 002 adds `roles`, `users`, `refresh_tokens`, `audit_logs`.
- API: POST /auth/login, /auth/refresh, /auth/logout, /auth/change-password; GET /auth/me.
- New required env var: JWT_SECRET. New dependencies: bcryptjs, jsonwebtoken, cookie-parser (backend), react-router-dom (frontend).
- Breaking changes: none.

## v0.1.0 (Phase 01, foundation)
- Features: project structure, Express API skeleton under /api/v1, React landing page, live status panel.
- Security: Helmet headers, CORS allow-list, rate limiting, request IDs, sanitized errors, log redaction.
- Database: migration runner with checksums; tables `universities`, `system_settings`.
- API: GET /api/v1/health, GET /api/v1/system/info.
- Breaking changes: none.
