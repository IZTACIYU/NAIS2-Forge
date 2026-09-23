export interface ShareCardFields {
    model: string
    positive: string
    negative: string
    steps: string
    cfgScale: string
    cfgRescale: string
    sampler: string
    scheduler: string
    quality: string
    uc: string
}

export function cardGroups(fields: ShareCardFields) {
    return [
        [{ label: 'MODEL', value: fields.model }],
        [{ label: 'BASE PROMPT', value: fields.positive }],
        [{ label: 'NEGATIVE PROMPT', value: fields.negative }],
        [{ label: 'STEPS', value: fields.steps }],
        [{ label: 'CFG SCALE', value: fields.cfgScale }, { label: 'CFG RESCALE', value: fields.cfgRescale }],
        [{ label: 'SAMPLER', value: fields.sampler }, { label: 'SCHEDULER', value: fields.scheduler }],
        [{ label: 'QUALITY TAGS', value: fields.quality }, { label: 'UC PRESET', value: fields.uc }],
    ]
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char))

export function cardHtml(fields: ShareCardFields): string {
    const rows = cardGroups(fields).map(group => `<div class="group">${group.map(({ label, value }) =>
        `<section><div class="label">${escapeHtml(label)}<button type="button" data-copy="${escapeHtml(value)}" aria-label="Copy ${escapeHtml(label)}">Copy</button></div><div class="value">${escapeHtml(value || '-')}</div></section>`
    ).join('')}</div>`).join('')
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>NAIS2 prompt share card</title><style>body{margin:0;background:#1b1b1b;color:#f4f1ed;font:16px/1.5 system-ui,sans-serif}main{max-width:656px;margin:auto;padding:32px}.group{display:flex;gap:12px;margin-bottom:24px}.group section{flex:1;min-width:0}.label{display:flex;align-items:center;justify-content:space-between;color:#e3c884;font-size:15px;font-weight:700}.value{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px}button{border:1px solid #e3c884;color:#e3c884;background:transparent;border-radius:6px;padding:3px 7px;cursor:pointer}</style><main>${rows}</main><script>document.addEventListener('click',async e=>{const b=e.target.closest('button[data-copy]');if(!b)return;const v=b.getAttribute('data-copy');try{await navigator.clipboard.writeText(v)}catch{const t=document.createElement('textarea');t.value=v;document.body.append(t);t.select();document.execCommand('copy');t.remove()}b.textContent='Copied'})</script></html>`
}
