FROM quay.io/keycloak/keycloak:26.5.6

ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true
ENV KC_DB=postgres

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start"]
