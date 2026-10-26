# Include once in each existing aitoshuu.me / tongye.me HTTPS server block.
location = /Focuence {
    include /www/server/panel/vhost/snippets/focuence-proxy.inc;
}
location ^~ /Focuence/ {
    include /www/server/panel/vhost/snippets/focuence-proxy.inc;
}
