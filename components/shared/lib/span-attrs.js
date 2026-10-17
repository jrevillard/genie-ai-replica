// Mirror of genie-ai-overlay/core/span_attrs.py. The two must agree on
// QUERY_ID_KEY and MAX_STRING_LEN or the correlation id is minted on one side
// and read on the other, or the privacy bounds silently diverge.

const QUERY_ID_KEY = 'genie.query_id';
const MAX_STRING_LEN = 96;

module.exports = { QUERY_ID_KEY, MAX_STRING_LEN };
