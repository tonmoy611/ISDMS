'use strict';
const router = require('express').Router();

// Each later phase mounts its module here (auth, students, finance, ...).
router.use('/health', require('./v1/health'));
router.use('/auth', require('./v1/auth'));
router.use('/users', require('./v1/users'));
router.use('/permissions', require('./v1/permissions'));
router.use('/universities', require('./v1/universities'));
router.use('/structure', require('./v1/structure'));
router.use('/students', require('./v1/students'));
router.use('/courses', require('./v1/courses'));
router.use('/sections', require('./v1/sections'));
router.use('/enrollment', require('./v1/enrollment'));
router.use('/attendance', require('./v1/attendance'));
router.use('/results', require('./v1/results'));
router.use('/documents', require('./v1/documents'));
router.use('/verify', require('./v1/verify'));
router.use('/finance', require('./v1/finance'));
router.use('/system', require('./v1/system'));

module.exports = router;
