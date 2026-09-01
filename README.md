# Recursos Dashboard

## Dashboard de Solicitudes de Orden de Compra

**URL en vivo (la oficial, usar esta):**
https://script.google.com/a/macros/mercadolibre.com/s/AKfycbzjMdGCaVvovI96RLSe0fV94gf-RHRZ-443uU0dkBzpMFYgtm0xHiFj0q_Kw7HP2QY/exec

Corre directo desde Apps Script (Google), con datos y tipo de cambio en vivo.
Cualquier usuario con cuenta @mercadolibre.com puede abrirla.

- Backend: `apps-script/OrdenesCompraCode.gs`
- Frontend (servido por el Apps Script vía HtmlService): `apps-script/Dashboard.html`

**Para actualizar el dashboard en vivo** después de un cambio en estos archivos:
1. Abrir la planilla → Extensiones → Apps Script.
2. Pegar el contenido actualizado en `Código.gs` y/o `Dashboard.html` (los que hayan cambiado).
3. Guardar.
4. Implementar → Administrar implementaciones → lápiz ✏️ sobre la implementación activa → Versión: "Nueva versión" → Implementar.
5. La URL no cambia entre versiones — no hace falta repartirla de nuevo.

**Versión estática de respaldo** (foto fija, no requiere cuenta de Google):
`ordenes-compra.html`, publicada por GitHub Pages en:
https://ailenrojas-ops.github.io/recursos-dashboard/ordenes-compra.html

Tiene el mismo código/UI que `Dashboard.html`, pero con un snapshot de datos embebido (no se actualiza solo).

## Dashboard de Recursos Externos TA

`index.html`, publicado por GitHub Pages en:
https://ailenrojas-ops.github.io/recursos-dashboard/index.html

Consume datos vía un Apps Script Web App separado (URL configurada en `API_URL` dentro de `index.html`).
