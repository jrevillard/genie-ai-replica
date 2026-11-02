window.APP_CONFIG = {
  apiUrl: "/api",
  proxyHost: "localhost",
  cspConnectSrc: "'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090",
  // DEV-SERVER OKF FLAG (round 20, #80798): this tracked file is what
  // `npm run serve` ships, and WITHOUT the key the strict isOkfEnabled()
  // read left every OKF surface dark locally (a runtime config EXISTS on
  // the dev server, so the "no config → enabled" dev arm never fired).
  // '1' keeps the dev surfaces visible; production is unaffected — the
  // container entrypoint OVERWRITES this file with the deployment's own
  // value from VUE_APP_OKF_ENABLED (docker-entrypoint.sh).
  okfEnabled: "1",
  keycloak: {
    url: "",
    client_id: "genie-app"
  }
};
