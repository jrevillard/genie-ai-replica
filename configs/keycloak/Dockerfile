FROM quay.io/keycloak/keycloak:26.5.6

ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true
ENV KC_DB=postgres

COPY themes/ /opt/keycloak/themes/

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start"]
