const { getTracer } = require('./tracing');

function traceQuery(queryFn, { collection, operation }) {
  const tracer = getTracer();
  const span = tracer.startSpan(`db.${operation} ${collection}`);
  span.setAttribute('db.system', 'arangodb');
  span.setAttribute('db.name', process.env.ARANGO_DB || 'genie_db');
  span.setAttribute('db.collection', collection);
  span.setAttribute('db.operation', operation);

  return queryFn()
    .then((result) => {
      span.end();
      return result;
    })
    .catch((err) => {
      span.recordException(err);
      span.end();
      throw err;
    });
}

module.exports = { traceQuery };
