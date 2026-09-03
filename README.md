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

**Versión en Grid** (`grid.adminml.com`, link corto interno de ML) — EN PAUSA, ver nota abajo:
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

> **Estado (2026-09-02): en pausa.** Al generar el token, `POST /api/v1/tokens` en Grid
> devolvió 503 y luego 504 (caída de infraestructura del lado de Grid, no de nuestro código).
> Retomar cuando el servicio esté estable — probar de nuevo el mismo comando del paso 1.

## Alertas de servicios mensuales

Detecta servicios (Proveedor + Sociedad + Moneda + Categoría) que aparecen en al menos 2 de
los últimos 3 meses pero no tienen ninguna solicitud cargada en el mes actual — para poder
avisarle al solicitante habitual o provisionar el gasto esperado (se informa el promedio
mensual en USD de los meses con datos).

- Pestaña **"Alertas Mensuales"** en el dashboard en vivo (`Dashboard.html`), se carga sola
  al abrirla.
- Mail automático mensual con el mismo resumen: `monthlyAlertEmail()` en `OrdenesCompraCode.gs`,
  pensado para un disparador de tipo "basado en tiempo" → mensual → día 10 → función
  `monthlyAlertEmail`. Envía a `ailen.rojas@mercadolibre.com`. Si no hay alertas ese mes,
  no manda nada (no genera ruido).

## Control de Pagos a Proveedores (nuevo, en pruebas)

Proyecto **totalmente separado** del dashboard de Solicitudes de Orden de Compra —
planilla propia, formulario propio, Apps Script propio. No toca ni depende de
`OrdenesCompraCode.gs` / `Dashboard.html`, así se puede probar e iterar sin
riesgo de romper lo que ya está en producción.

**Objetivo:** que cualquiera pueda cargar el soporte de una factura/pago (excel,
pdf, captura de un mail) sin tener que saber de memoria el Centro de Costo o la
Cuenta Contable del proveedor — eso se autocompleta a partir de un maestro que
se carga una única vez por proveedor.

```mermaid
flowchart TD
    A[Alguien completa el Form:\nelige Proveedor + adjunta soporte] --> B[onFormSubmit se dispara solo]
    B --> C{Proveedor ya está en\nMaestro Proveedores?}
    C -- Sí --> D[Autocompleta Centro de Costo,\nCuenta Contable, Sociedad, Head]
    C -- No --> E[Fila queda "Falta clasificar"\n+ mail de aviso]
    E -. se completa una vez en el Maestro .-> F[Reclasificar pendientes\naplica retroactivo]
    D --> G[Si el adjunto es Excel,\nintenta extraer el Monto solo]
    G --> H[Fila nueva en la hoja "Pagos"]
    F --> H
```

**Setup (una sola vez):**
1. Crear una planilla de Google nueva, por ejemplo "Control de Pagos a Proveedores".
2. En esa planilla, crear la hoja **"Maestro Proveedores"** con las columnas:
   `Proveedor | Servicio | Centro de Costo | Cuenta Contable | Sociedad | Moneda habitual | Usuario habitual | Head | Notas`
   y cargar ahí los proveedores que ya se conocen (se puede ir completando de a poco).
3. Crear un **Google Form** llamado por ejemplo "Carga de Soporte de Pago" con estas preguntas
   (el texto tiene que coincidir exactamente, están hardcodeadas en `FORM_Q` dentro de `Code.gs`):
   - `Proveedor` (lista desplegable o texto corto)
   - `Servicio (opcional)`
   - `Monto (si lo sabés)`
   - `Moneda (si la sabés)`
   - `Mes de pago`
   - Una pregunta de tipo **"Subir archivo"** para el soporte (obligatoria)
   - Recolectar el email del que responde (Configuración del Form)
4. En el Form: Respuestas > ícono de Sheets > vincular a la planilla del paso 1 (esto crea
   la hoja de respuestas automáticamente).
5. Extensiones > Apps Script (desde la planilla). Pegar `apps-script/proveedores-pagos/Code.gs`
   como `Code.gs`, y crear un archivo HTML nuevo llamado `Dashboard` con el contenido de
   `apps-script/proveedores-pagos/Dashboard.html`.
6. Disparadores (reloj) > Añadir disparador > función `onFormSubmit`, evento "Al enviar
   formulario", origen "Desde la hoja de cálculo".
7. (Opcional, fase 2) Para intentar extraer el Monto de PDFs/imágenes vía OCR: Servicios >
   agregar el servicio avanzado "Drive API", y en Propiedades del script agregar
   `OCR_HABILITADO` = `true`. Es experimental — si falla, el registro se crea igual y el
   monto queda para completar a mano, no bloquea nada.
8. (Opcional) Implementar > Nueva implementación > Aplicación web, para tener el mini
   dashboard de resumen del mes (`doGet` en `Code.gs`).

**Uso del día a día:**
- La persona solo elige el proveedor y adjunta el soporte — nada más.
- Si el proveedor ya está clasificado, la fila en "Pagos" sale completa sola.
- Si es un proveedor nuevo, se recibe un mail; se completa el Centro de Costo/Cuenta
  Contable en el Maestro una vez, y se corre "Pagos Proveedores > Reclasificar pendientes"
  desde el menú de la planilla para que se aplique también a lo ya cargado.

## Dashboard de Recursos Externos TA

`index.html`, publicado por GitHub Pages en:
https://ailenrojas-ops.github.io/recursos-dashboard/index.html

Consume datos vía un Apps Script Web App separado (URL configurada en `API_URL` dentro de `index.html`).
