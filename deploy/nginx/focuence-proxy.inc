# Shared path-preserving proxy from the public entry to the Tencent origin.
proxy_pass http://122.51.59.89;
proxy_http_version 1.1;
proxy_set_header Host focuence-origin.internal;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header Connection "";
proxy_connect_timeout 5s;
proxy_read_timeout 15s;
proxy_send_timeout 15s;
proxy_redirect off;
proxy_intercept_errors off;
proxy_cache off;
add_header Strict-Transport-Security "max-age=31536000" always;
