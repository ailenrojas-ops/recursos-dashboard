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

**Versión en Grid** (`grid.adminml.com`, link corto interno de ML):
https://grid.adminml.com/d/01M1F26PZQMN55W9B3WD5BJFKE/view

Documento subido a Grid con `ordenes-compra.html`. Igual que la versión de GitHub Pages, es
una foto fija — pero se actualiza sola una vez por día vía `dailyGridRefresh()` en
`apps-script/OrdenesCompraCode.gs`, que genera el HTML con datos frescos (usando
`apps-script/OrdenesCompraTemplate.html` como plantilla) y lo sube a Grid con
`POST /api/v1/documents/{doc_id}/versions` (la llamada la hace el propio Apps Script,
así que no choca con el bloqueo de CORS que tiene el fetch desde el navegador).

Setup del refresco automático a Grid (una sola vez):
1. En Grid, generar un token de API con scope "content" (`POST /api/v1/tokens` — alcanza con
   correrlo una vez autenticado en el navegador, por ejemplo desde la consola de DevTools en
   `grid.adminml.com`: `fetch('/api/v1/tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'apps-script-daily-refresh'})}).then(r=>r.json()).then(console.log)`).
2. En el editor de Apps Script → ⚙️ Configuración del proyecto → Propiedades del script →
   agregar `GRID_TOKEN` con el valor del token (nunca pegarlo en el código ni compartirlo).
3. Subir `apps-script/OrdenesCompraTemplate.html` como un archivo HTML más del mismo proyecto
   (con ese nombre exacto).
4. Editor de Apps Script → reloj (Disparadores) → Añadir disparador → función
   `dailyGridRefresh`, evento basado en tiempo, una vez por día.

## Dashboard de Recursos Externos TA

`index.html`, publicado por GitHub Pages en:
https://ailenrojas-ops.github.io/recursos-dashboard/index.html

Consume datos vía un Apps Script Web App separado (URL configurada en `API_URL` dentro de `index.html`).
