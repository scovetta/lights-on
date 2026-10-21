ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY cache/_cacache/ /opt/lights-on-npm-cache/_cacache/
COPY inputs/ /opt/lights-on-npm-inputs/
COPY npm-install.mjs /opt/lights-on-npm-install.mjs
COPY npm-wrapper.sh /opt/lights-on-npm
RUN chmod -R a+rX /opt/lights-on-npm-cache /opt/lights-on-npm-inputs && \
    chmod 644 /opt/lights-on-npm-install.mjs && chmod 755 /opt/lights-on-npm && \
    rm /usr/local/bin/npm && ln -s /opt/lights-on-npm /usr/local/bin/npm
