// Executed only in the embedded Danbooru page. Return data through a receive-only native protocol.
(async (target, origin, replyUrl) => {
    let result;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        if (location.origin !== origin) throw new Error('Danbooru page changed during extraction');
        let url = location.href;
        let html;
        if (target === null) {
            // The user already loaded this document, including any browser challenge or login.
            html = document.documentElement.outerHTML;
        } else {
            const requested = new URL(target);
            if (requested.origin !== origin || !/^\/(wiki_pages|posts)\//.test(requested.pathname)) {
                throw new Error('Only same-origin Danbooru wiki and post pages are allowed');
            }
            const response = await fetch(requested.href, {
                credentials: 'same-origin', redirect: 'error', signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Danbooru HTTP ${response.status}: ${requested.pathname}`);
            url = response.url;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let bytes = 0;
            html = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > 4 * 1024 * 1024) {
                    await reader.cancel();
                    throw new Error('Danbooru page is too large');
                }
                html += decoder.decode(value, { stream: true });
            }
            html += decoder.decode();
        }
        if (location.origin !== origin) throw new Error('Danbooru page changed during extraction');
        if (new TextEncoder().encode(html).length > 4 * 1024 * 1024) throw new Error('Danbooru page is too large');
        result = { url, html };
    } catch (error) {
        result = { error: String(error) };
    } finally {
        clearTimeout(timer);
    }
    await fetch(replyUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(result) });
})
