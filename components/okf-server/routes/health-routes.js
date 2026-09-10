// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const express = require('express');
const { DateTime } = require('luxon');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'okf-server',
    timestamp: DateTime.now().toUTC().toISO()
  });
});

module.exports = router;
