// Cloudflare Workers 用プロキシ（無料枠で動作）
// 使い方: Cloudflare ダッシュボード → Workers & Pages → Worker を作成 → このコードを貼り付けて Deploy
// 発行された https://xxxx.workers.dev/ を ChromeOS ランチャーの「設定 > Chrome > プロキシ URL」に入力
// 仕組み: X-Frame-Options / CSP を除去し、HTML 内のリンクをこのプロキシ経由に書き換えて iframe で表示できるようにします。
// 制限: Cookie は転送しません（ログインが必要なサイト、動画配信、JS で動的に API を叩くサイトは動かない場合があります）。

const CORS = { 'access-control-allow-origin': '*' };

export default {
  async fetch(req) {
    const self = new URL(req.url);
    const t = self.searchParams.get('url');
    if (!t) return new Response('使い方: ?url=https://example.com', { status: 400, headers: CORS });
    let target;
    try { target = new URL(t); } catch { return new Response('不正な URL', { status: 400, headers: CORS }); }
    if (!/^https?:$/.test(target.protocol)) return new Response('http/https のみ対応', { status: 400, headers: CORS });

    const px = self.origin + self.pathname + '?url=';
    const abs = (v, base) => { try { return px + encodeURIComponent(new URL(v, base).href); } catch { return v; } };

    const h = new Headers(req.headers);
    ['origin', 'referer', 'host', 'cookie'].forEach(k => h.delete(k));
    h.set('accept-language', 'ja,en;q=0.8');

    const r = await fetch(target, {
      method: req.method,
      headers: h,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      redirect: 'manual',
    });

    // リダイレクトもプロキシ経由にする
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      return new Response(null, { status: 302, headers: { ...CORS, location: abs(loc, target) } });
    }

    const rh = new Headers(r.headers);
    ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'set-cookie', 'content-encoding', 'content-length']
      .forEach(k => rh.delete(k));
    Object.entries(CORS).forEach(([k, v]) => rh.set(k, v));

    const type = rh.get('content-type') || '';
    if (!type.includes('text/html')) return new Response(r.body, { status: r.status, headers: rh });

    const attr = a => ({
      element(e) {
        const v = e.getAttribute(a);
        if (v && !/^(data:|javascript:|#|mailto:|tel:|blob:)/i.test(v)) e.setAttribute(a, abs(v, target));
        e.removeAttribute('integrity');
        e.removeAttribute('nonce');
      },
    });
    const inject =
      `<base href="${target.href}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{overflow-x:hidden!important;max-width:100vw}img,video{max-width:100%}</style>` +
      `<script>try{parent.postMessage({crosUrl:${JSON.stringify(target.href)}},"*")}catch(e){}</script>`;

    return new HTMLRewriter()
      .on('head', { element(e) { e.prepend(inject, { html: true }); } })
      .on('a[href],area[href],link[href]', attr('href'))
      .on('img[src],script[src],iframe[src],source[src],video[src],audio[src],embed[src],input[src]', attr('src'))
      .on('form[action]', attr('action'))
      .transform(new Response(r.body, { status: r.status, headers: rh }));
  },
};
