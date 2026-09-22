window.APP_CONFIG = {
  apiUrl: "/api",
  proxyHost: "localhost",
  cspConnectSrc: "'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090",
  keycloak: {
    url: "",
    client_id: "genie-app"
  },
  app: {
    banner: { url: "/assets/agrogenio/banner.png" },
    mascot: { url: "/assets/agrogenio/mascot-avatar.png", alt: "AgroGenio mascot" },
    leaves: { url: "/assets/agrogenio/leaves-large.png" },
    sidebarLeaf: { url: "/assets/agrogenio/leaf-particles.png" }
  }
};
