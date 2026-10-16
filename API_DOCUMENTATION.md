# ISDMS API (v1). Base path /api/v1
Responses: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message", "details", "requestId" } }`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health | none | Server and database status |
| GET | /system/info | none | Product name, version, developer |
| POST | /auth/login | none | Body `{loginId, password}`. Sets session cookies. Rate limited |
| POST | /auth/refresh | refresh cookie | Rotates the session |
| POST | /auth/logout | none | Revokes the refresh token, clears cookies |
| GET | /auth/me | session | Current user |
| POST | /auth/change-password | session | Body `{currentPassword, newPassword}`. Signs out other devices |

Auth error codes: UNAUTHORIZED, TOKEN_EXPIRED, ACCOUNT_LOCKED (429), ACCOUNT_BLOCKED, ACCOUNT_INACTIVE, VERIFICATION_REQUIRED, PASSWORD_CHANGE_REQUIRED (403).

## Users (session + permission required)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /users | users.view | Query: page, pageSize (max 100), q, role, status |
| POST | /users | users.create | `{loginId, fullName, email, phone?, role, temporaryPassword, universityId?}` role: teacher, staff (super_admin only by Super Admin) |
| GET | /users/:id | users.view | |
| PATCH | /users/:id | users.update | `{fullName?, email?, phone?}` |
| POST | /users/:id/status | users.status | `{status: active|blocked|inactive}`; not on yourself; keeps one active Super Admin |
| POST | /users/:id/reset-password | users.update | `{temporaryPassword}`; signs the user out everywhere |

## Permissions
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | /permissions | permissions.view | Catalog and role matrix |
| PUT | /permissions/roles/:code | Super Admin | `{permissions:[codes]}` |
| GET | /permissions/users/:id | permissions.view | Role defaults, overrides, effective list |
| PUT | /permissions/users/:id | Super Admin | `{grant:[], deny:[]}` |

## Universities (permission structure.view to read; writes Super Admin only)
| Method | Path | Notes |
|---|---|---|
| GET | /universities | Platform admin sees all; others see only their own. Query: q, page, pageSize |
| POST | /universities | Platform Super Admin. `{code, name, shortName?, contactEmail?, contactPhone?, address?}` |
| GET / PATCH | /universities/:id | PATCH edits details (not the code) |
| POST | /universities/:id/status | Platform Super Admin. `{status: active|inactive}` |

## University structure (structure.view to read, structure.manage to change)
Resources: `campuses`, `faculties`, `departments` (facultyId), `programs` (departmentId, degreeLevel, durationSemesters), `batches` (programId), `academic-years`, `semesters` (academicYearId), `shifts` (startTime, endTime).
| Method | Path | Notes |
|---|---|---|
| GET | /structure/:resource | Query: universityId (platform admin), q, status, parent id filter, page, pageSize (max 200) |
| POST | /structure/:resource | Platform admin must send universityId |
| GET / PATCH / DELETE | /structure/:resource/:id | DELETE returns 409 if the record is in use |
| POST | /structure/academic-years/:id/set-current, /structure/semesters/:id/set-current | One current per university |

## Students (permission students.*)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /students | students.view | Query: q, status, academicStatus, departmentId, programId, batchId, semesterId, universityId (platform admin), page, pageSize |
| POST | /students | students.create | studentId, fullName, email, phone, temporaryPassword, departmentId, programId, batchId, academicYearId, semesterId, shiftId, admissionDate, optional profile fields; platform admin adds universityId |
| GET / PATCH | /students/:id | students.view / students.update | National ID only in the detail view |
| POST | /students/:id/status | students.status | `{status}` same rules as users |
| POST | /students/:id/reset-password | students.update | `{temporaryPassword}` |
| DELETE | /students/:id | students.delete | Soft delete |
| GET / PATCH | /students/me | role student | Own record; PATCH accepts only guardianPhone, presentAddress, permanentAddress, emergencyContactName, emergencyContactPhone |

## Verification and password reset (public, rate limited)
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | /auth/login | `{loginId, password}` | For a new account with the right temporary password returns `{verificationRequired: true, verificationToken, channels:[{channel, masked}]}` and sets no cookies |
| POST | /auth/verification/send | `{verificationToken, channel}` | channel: email or sms. 3 codes per 15 minutes |
| POST | /auth/verification/complete | `{verificationToken, code, newPassword}` | Activates the account, signs in |
| POST | /auth/password/forgot | `{loginId, channel?}` | Always answers success so accounts cannot be discovered |
| POST | /auth/password/reset | `{loginId, code, newPassword}` | Signs out all sessions |
Error codes added: DELIVERY_FAILED (503), RATE_LIMITED (429).

## Courses (permissions courses.view / courses.manage)
Course list, create, edit and delete use the generic resource `courses` under /structure (fields: code, title, departmentId, credit in steps of 0.5, courseType, description, status; filters: q, status, courseType, departmentId).
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /courses/:id | courses.view | Course plus prerequisites, requiredBy, programs |
| PUT | /courses/:id/prerequisites | courses.manage | `{prerequisiteIds:[...]}` replaces the set; 409 if it would create a loop |
| GET | /courses/curriculum/:programId | courses.view | Items by semester, total credits, effective credit rule, warnings |
| PUT | /courses/curriculum/:programId | courses.manage | `{items:[{courseId, semesterNo, isMandatory}]}` replaces the curriculum |
| GET | /courses/credit-rules | courses.view | Query universityId (platform admin) |
| PUT | /courses/credit-rules | courses.manage | `{programId|null, minCredits, maxCredits, totalCreditsRequired?, universityId?}` upsert |
| DELETE | /courses/credit-rules/:id | courses.manage | |
| POST | /courses/validate-selection | courses.view | `{programId, courseIds, completedCourseIds?, alreadyRegisteredCredits?, checkMinimum?}` returns `{ok, totalCredits, errors:[{code, courseId, message}]}`; saves nothing |
| GET | /courses/my | role student | Own program curriculum |
Selection error codes: EMPTY_SELECTION, UNKNOWN_COURSE, DUPLICATE_SELECTION, COURSE_INACTIVE, NOT_IN_CURRICULUM, ALREADY_COMPLETED, PREREQUISITE_MISSING, CREDIT_ABOVE_MAX, CREDIT_BELOW_MIN.

## Sections and schedule (sections.view / sections.manage)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /sections | sections.view | Query: semesterId, courseId, teacherId, status, q, universityId (platform), page, pageSize |
| POST | /sections | sections.manage | `{courseId, semesterId, sectionCode, capacity, teacherId?, shiftId?, status?, notes?, universityId?}` |
| GET / PATCH / DELETE | /sections/:id | view / manage / manage | GET returns section and slots. Changing the teacher is refused (409) if it clashes |
| PUT | /sections/:id/slots | sections.manage | `{slots:[{dayOfWeek 1-7, startTime, endTime, roomId?, slotType}]}` replaces the schedule; 409 with `details.conflicts` on room or teacher clashes; response includes `warnings` (room smaller than section) |
| GET | /sections/teachers | sections.manage | Active teachers of the university |
| GET | /sections/timetable | sections.view | Query: semesterId (required), roomId, teacherId |
| GET | /sections/teaching | role teacher | The teacher's own sections and slots |
Rooms: /structure/rooms (sections.view/manage). Academic calendar: /structure/calendar-events (calendar.view/manage).

## Enrollment
Students use `/enrollment/me/...`; staff use `/enrollment/students/:studentId/...` with enrollment.view (read) or enrollment.manage (change). Staff may send `override: true` (needs enrollment.override) to act outside the registration dates.
| Method | Path | Body or query | Notes |
|---|---|---|---|
| GET | .../overview | `?semesterId` (defaults to the current semester) | Window state, registration, enrolled courses, credit rule, available courses with eligibility and seats left |
| POST | .../register | `{semesterId?, sectionIds:[...]}` | Only while registration is open. All sections or none |
| POST | .../add | `{semesterId?, sectionId}` | Until add/drop ends |
| POST | .../drop | `{enrollmentId, reason?}` | Cannot go below minimum credits or drop the last course |
| POST | .../cancel | `{semesterId?, reason?}` | Drops every course |
| GET | .../history | | Every semester with all lines, including dropped |
| GET, POST | /enrollment/students/:studentId/prior-credits | `{courseId, source: transfer|exemption|legacy, note?}` | enrollment.view / manage |
| DELETE | /enrollment/students/:studentId/prior-credits/:id | | enrollment.manage |
| GET | /enrollment/registrations | `?semesterId, status, q, universityId, page` | enrollment.view |
| GET | /enrollment/sections/:sectionId/roster | | enrollment.view, or the section's teacher |
Rejections are 422 `ENROLLMENT_REJECTED` with `details.errors:[{code, sectionId, message}]`. Codes: SECTION_CLOSED, SECTION_FULL, ALREADY_REGISTERED, TIMETABLE_CLASH, LAST_COURSE and the selection codes listed under Courses. Date problems are 403 `REGISTRATION_CLOSED`.
Semesters now accept `registrationStart`, `registrationEnd`, `addDropEnd` (all three optional; registration stays closed until the first two are set).

## Attendance
Section and session routes are open to the section's own teacher, to attendance.manage (any section) and, read-only, to attendance.view.
| Method | Path | Notes |
|---|---|---|
| GET | /attendance/sections/:sectionId/sessions | Classes held with counts; returns `today` and `canMark` |
| POST | /attendance/sections/:sectionId/sessions | `{date, classNo?, topic?}`; not in the future, inside the semester; teachers within ATTENDANCE_EDIT_DAYS |
| GET | /attendance/sections/:sectionId/summary | Per student counts, percentage, `below` flag |
| GET / DELETE | /attendance/sessions/:id | GET returns the roster of enrolled students with their marks |
| PUT | /attendance/sessions/:id/records | `{records:[{studentId, status: present|absent|late|excused, note?}]}`; students must be enrolled in the section |
| GET | /attendance/me, /attendance/me/sections/:sectionId | Student's own summary and day-by-day |
| GET | /attendance/students/:studentId and .../sections/:sectionId | attendance.view |
| GET | /attendance/report | attendance.view. `?semesterId, q, sectionId, belowThreshold=1, universityId, page` |
| GET / PUT | /attendance/policy | view / attendance.manage. `{minPercent, universityId?}` |

## Results
Section routes are open to the section's own teacher, to results.manage (any section) and, read-only, to results.view. Decided on the server.
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /results/sections | teacher (own) or results.view | `?semesterId, status (draft|submitted|published), q, universityId, page` |
| GET | /results/sections/:id/sheet | as above | Components, students with marks, preview grades, batch status, and what the caller `can` do |
| PUT | /results/sections/:id/components | teacher or results.manage | `{components:[{id?, name, maxMarks}]}` replaces the list. Draft only |
| PUT | /results/sections/:id/marks | teacher or results.manage | `{entries:[{enrollmentId, componentId, marks}]}`; empty marks clears. Draft only |
| POST | /results/sections/:id/submit | teacher or results.manage | Needs a grading scale and a mark for every enrolled student. 422 `details.missing` lists gaps |
| POST | /results/sections/:id/reopen | results.manage | Submitted back to draft |
| POST | /results/sections/:id/publish | results.publish | Not by the person who submitted. Sets enrollment outcomes |
| POST | /results/entries/:resultId/corrections | teacher or results.manage | `{reason (10-500 chars), changes:[{componentId, marks}]}`; published results only |
| GET | /results/entries/:resultId/history | teacher, results.manage or results.view | Every version |
| GET | /results/corrections | results.approve | `?status=pending|approved|rejected` with current and proposed grade |
| POST | /results/corrections/:id/approve, /reject | results.approve | `{note?}`; not by the requester |
| GET, PUT | /results/grade-scale | results.view / results.manage | `{entries:[{letter, minPercent, gradePoint, isPass}], universityId?}` |
| POST | /results/grade-scale/default | results.manage | Loads the standard 4.00 scale if none exists |
| GET | /results/me, /results/students/:studentId | student / results.view | Published results by semester with GPA, CGPA, credits earned and attempted |
Rejections: 422 `RESULT_REJECTED` (details.missing for submit).

## Documents
Types: `transcript`, `semester_result`, `admit_card`, `enrollment_confirmation`. Semester types take an optional `semesterId` (default: the current semester).
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /documents/me, /documents/me/options | student | Own issued documents; semesters with `hasResults` |
| POST | /documents/me/generate | student | `{type, semesterId?}`. Transcript is a student copy. Returns `{document:{id, serial, reused}}` |
| GET | /documents/students/:studentId | documents.view | |
| POST | /documents/students/:studentId/generate | documents.issue | `{type, semesterId?, override?, reason?}`; override only for admit cards and needs documents.override |
| GET | /documents | documents.view | `?q, type, universityId, page` |
| GET | /documents/:id | owner or documents.view | Metadata |
| GET | /documents/:id/print | owner or documents.view | Print-ready HTML. `?download=1` downloads it. No script, strict CSP |
| POST | /documents/:id/revoke | documents.manage | `{reason}` (10-500 characters) |
| GET | /verify/:serial?code=XXXXXXXXXXXX | public, rate limited | `{valid, revoked?, type, official, issuedAt, university, studentName, studentId, semester}`; `{valid:false}` for anything that does not match |
Errors: 422 `DOCUMENT_NOT_AVAILABLE` with `details.reasons` (for example attendance below the minimum, no confirmed registration, no published results).

## Finance
Money amounts are decimals in BDT. Permissions: finance.view (read), finance.manage (setup, invoices, concessions), finance.collect (record payments).
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | /finance/me | student | Totals, own invoices, payments |
| GET, PUT | /finance/settings | view / manage | `{lateMode: none|flat|percent, lateValue, lateGraceDays, lateCap?, admitCardRequiresClearance, defaultDueDays}` |
| GET, POST | /finance/fee-heads | view / manage | `{code, name, calcType: fixed|per_credit|per_course|per_lab_course, appliesTo: admission|semester}` |
| PATCH | /finance/fee-heads/:id | manage | `{name?, status?}` |
| GET, PUT | /finance/fee-schedule | view / manage | `?programId` (empty = university default). PUT `{programId|null, items:[{feeHeadId, amount}]}` replaces that scope |
| GET | /finance/students/:studentId | view | Totals, invoices, concessions |
| POST | /finance/students/:studentId/invoices | manage | `{type: semester|admission, semesterId?, dueDate?}`; 409 if one exists; 422 NO_COURSES or NO_FEES |
| POST | /finance/students/:studentId/concessions | manage | `{kind, mode: percent|fixed, value, feeHeadId?, semesterId?, reason}`; `/:id/revoke` ends it |
| POST | /finance/invoices/generate-semester | manage | `{semesterId, programId?, batchId?, dueDate?}` returns created, alreadyInvoiced, skipped, problems |
| GET | /finance/invoices | view | `?semesterId, state (unpaid|partial|overdue|paid|cancelled), q, page` |
| GET | /finance/invoices/:id | owner student or view | Lines, installments (with coverage), payments, derived state |
| POST | /finance/invoices/:id/recalculate | manage | Only with no payments; removes installments |
| POST | /finance/invoices/:id/adjustments | manage | `{description, amount}` (negative reduces) |
| PUT | /finance/invoices/:id/installments | manage | `{count, firstDueDate, intervalDays}` or `{installments:[{dueDate, amount}]}` (must add up to the total) or `{installments: []}` to remove |
| POST | /finance/invoices/:id/cancel | manage | `{reason}`; only with no payments |
| POST | /finance/invoices/:id/payments | collect | `{amount, method: cash|bank_transfer|cheque, reference?, note?, idempotencyKey?}`; 422 OVERPAYMENT |
| GET | /finance/payments | view | `?method, status, q, page` |
| POST | /finance/late-fees/assess | manage | `{semesterId?}`; 422 LATE_FEES_OFF |
| GET | /finance/summary | view | Billed, collected, outstanding, overdue, counts, by method |
Receipts: POST /documents/me/receipts and POST /documents/students/:studentId/receipts (documents.issue or finance.collect), body `{paymentId}`.
