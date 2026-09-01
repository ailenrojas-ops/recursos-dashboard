/**
 * Backend para el Dashboard de Solicitudes de Orden de Compra.
 * Setup (en el Google Sheet que tiene la solapa "Respuestas"):
 *   1. Extensiones > Apps Script.
 *   2. Pegar este archivo como Code.gs.
 *   3. Archivo > Nuevo > Archivo HTML, nombrarlo "Dashboard", y pegar el
 *      contenido de apps-script/Dashboard.html.
 *   4. Implementar > Nueva implementación (o editar la existente) >
 *      Aplicación web: Ejecutar como "Yo", Acceso "Cualquier usuario de
 *      [tu dominio]".
 *   5. Abrir la URL /exec: sirve el dashboard directamente (mismo origen,
 *      sin problemas de CORS con el acceso restringido al dominio).
 *
 * doGet sirve el HTML del dashboard. getDashboardData() es la función que
 * el HTML llama vía google.script.run para traer los datos (sin fetch/CORS,
 * usa el canal interno de Apps Script). Se deja doGet(?format=json) como
 * endpoint JSON alternativo, por si se necesita consumir desde otro lado.
 */

function doGet(e) {
  if (e && e.parameter && e.parameter.format === "json") {
    try {
      var result = getPurchaseRequests_();
      return jsonOutput_({ ok: true, data: result.rows, fxByMonth: result.fxByMonth });
    } catch (err) {
      return jsonOutput_({ ok: false, error: err.message });
    }
  }
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle("Dashboard - Solicitudes de Orden de Compra")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getDashboardData() {
  var result = getPurchaseRequests_();
  return { data: result.rows, fxByMonth: result.fxByMonth };
}

// Tipos de cambio de referencia (unidades de moneda local por 1 USD),
// usados solo si falla la consulta a la API de tipos de cambio históricos.
// Actualizar cada tanto para que el fallback no quede muy desactualizado.
var FALLBACK_RATES_ = { MXN: 18.5, BRL: 5.6, ARS: 1000, CLP: 950, USD: 1 };

/**
 * Devuelve el tipo de cambio "de cierre" de un mes: el vigente al último día
 * de ese mes (o el último día disponible hacia atrás, por si cae en fin de
 * semana/feriado, o si el mes todavía está en curso). Así los montos en USD
 * de un mes ya cerrado no cambian aunque hoy el dólar valga otra cosa.
 */
function getMonthEndRates_(year, month) {
  var cache = CacheService.getScriptCache();
  var cacheKey = "fxHist_" + year + "_" + month;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  var lastDay = new Date(year, month, 0); // día 0 del mes siguiente = último día de "month"
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  if (lastDay > today) lastDay = today; // mes en curso: usar la fecha más reciente disponible

  var result = fetchHistoricalRates_(lastDay, 6);
  if (!result) {
    result = { rates: FALLBACK_RATES_, asOf: "Tipo de cambio de referencia (sin conexión a la API histórica)", source: "fallback" };
  }
  result.rates.USD = 1;
  try { cache.put(cacheKey, JSON.stringify(result), 21600); } catch (e) {} // máx. 6 hs permitidas por CacheService
  return result;
}

function fetchHistoricalRates_(date, maxDaysBack) {
  for (var i = 0; i <= maxDaysBack; i++) {
    var d = new Date(date.getTime() - i * 24 * 60 * 60 * 1000);
    var dateStr = formatDateYMD_(d);
    try {
      var url = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@" + dateStr + "/v1/currencies/usd.json";
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        var json = JSON.parse(resp.getContentText());
        if (json && json.usd) {
          var rates = {};
          Object.keys(json.usd).forEach(function (k) { rates[k.toUpperCase()] = json.usd[k]; });
          return { rates: rates, asOf: json.date || dateStr, source: "live" };
        }
      }
    } catch (err) {
      // intenta con el día anterior
    }
  }
  return null;
}

function formatDateYMD_(d) {
  return d.getFullYear() + "-" + pad2_(d.getMonth() + 1) + "-" + pad2_(d.getDate());
}

function pad2_(n) {
  return (n < 10 ? "0" : "") + n;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function findResponsesSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === "solicitudes") return sheets[i];
  }
  for (var i = 0; i < sheets.length; i++) {
    if (/respuesta/i.test(sheets[i].getName())) return sheets[i];
  }
  throw new Error('No se encontró una hoja llamada "Solicitudes" en la planilla.');
}

function getPurchaseRequests_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = findResponsesSheet_(ss);
  var values = sheet.getDataRange().getValues();

  var headerRowIdx = -1;
  for (var i = 0; i < Math.min(15, values.length); i++) {
    if (String(values[i][0]).trim() === "ID Vendor Management") {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error('No se encontró la fila de encabezados ("ID Vendor Management") en las primeras 15 filas.');
  }

  var headers = values[headerRowIdx].map(function (h) { return String(h).trim(); });
  var col = {};
  headers.forEach(function (h, idx) {
    if (h && col[h] === undefined) col[h] = idx;
  });

  function get(row, name) {
    var idx = col[name];
    return idx === undefined ? "" : row[idx];
  }

  var out = [];
  var fxByMonth = {};
  for (var r = headerRowIdx + 1; r < values.length; r++) {
    var row = values[r];
    var idRaw = get(row, "ID Vendor Management");
    if (idRaw === "" || idRaw === null) continue;
    var idNum = Number(idRaw);
    if (isNaN(idNum)) continue; // descarta separadores, #REF!, filas plantilla

    var fechaRaw = get(row, "Marca temporal");
    var fechaDate = fechaRaw instanceof Date ? fechaRaw : parseSpanishDate_(String(fechaRaw || ""));
    if (!fechaDate) continue; // sin fecha válida no se puede agrupar por mes

    var importe = normalizeAmount_(get(row, "Importe total"));
    var moneda = String(get(row, "Moneda") || "").trim() || "N/D";
    var sociedad = String(get(row, "Sociedad") || "").trim();
    var periodoRaw = get(row, "Periodo de servicio");
    var periodoDate = periodoRaw instanceof Date ? periodoRaw : parseSpanishDate_(String(periodoRaw || ""));

    var monthKey = fechaDate.getFullYear() + "-" + (fechaDate.getMonth() + 1);
    if (!fxByMonth[monthKey]) fxByMonth[monthKey] = getMonthEndRates_(fechaDate.getFullYear(), fechaDate.getMonth() + 1);
    var rate = fxByMonth[monthKey].rates[moneda];
    var importeUsd = (importe != null && rate) ? importe / rate : null;

    out.push({
      id: idNum,
      fecha: fechaDate.toISOString(),
      email: String(get(row, "Dirección de correo electrónico") || "").trim(),
      usuario: String(get(row, "En representación de usuario:") || "").trim(),
      titulo: String(get(row, "Título de solicitud") || "").trim(),
      categoria: String(get(row, "Categoría") || "").trim(),
      proveedor: cleanProveedor_(String(get(row, "Proveedor") || "").trim()),
      sociedad: sociedad,
      periodo: periodoDate ? periodoDate.toISOString() : null,
      importe: importe,
      moneda: moneda,
      importeUsd: importeUsd,
      head: String(get(row, "HEAD") || "").trim() || "Sin asignar",
      status: String(get(row, "Status") || "").trim() || "Sin status",
      oc: String(get(row, "OC") || "").trim(),
      pr: String(get(row, "PR") || "").trim(),
      contratoMarco: normalizeContrato_(get(row, "Contract compliance (contrato marco)"))
    });
  }
  return { rows: out, fxByMonth: fxByMonth };
}

function normalizeAmount_(v) {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  var s = String(v).trim().replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  var hasComma = s.indexOf(",") !== -1;
  var hasDot = s.indexOf(".") !== -1;
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", "."); // 1.211.933,42 -> 1211933.42
  } else if (hasComma && !hasDot) {
    s = s.replace(",", "."); // 45,50 -> 45.50
  }
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Frases que aparecen en la columna "Contrato Marco" pero no son un número de
// contrato real (indican que no aplica o que no hay saldo disponible).
var NO_CONTRATO_VALUES_ = ["no aplica", "sem saldo", "sem saldo suficiente", "não possui saldo suficiente", "no"];

function normalizeContrato_(v) {
  var s = String(v || "").trim();
  if (!s) return "";
  if (NO_CONTRATO_VALUES_.indexOf(s.toLowerCase()) !== -1) return "";
  return s;
}

function cleanProveedor_(s) {
  if (!s) return "Sin proveedor";
  return s.replace(/^\d+\s*-\s*/, "").trim() || s;
}

function parseSpanishDate_(s) {
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):?(\d{2})?:?(\d{2})?/);
  if (!m) return null;
  var day = parseInt(m[1], 10), month = parseInt(m[2], 10) - 1, year = parseInt(m[3], 10);
  var hh = parseInt(m[4] || "0", 10), mm = parseInt(m[5] || "0", 10), ss = parseInt(m[6] || "0", 10);
  return new Date(year, month, day, hh, mm, ss);
}

/**
 * Publicación diaria a Grid (grid.adminml.com) — mantiene actualizado el
 * documento estático de Grid sin depender de que un navegador le pida
 * datos en vivo al Apps Script (lo cual falla por CORS, ver comentario
 * de más arriba). Este código corre del lado del servidor de Google,
 * así que UrlFetchApp no tiene ese problema.
 *
 * Setup:
 *   1. En Grid, generar un token (ver getGridApiToken_ más abajo) y
 *      guardarlo en Configuración del proyecto > Propiedades del script
 *      con la clave GRID_TOKEN.
 *   2. Confirmar/ajustar GRID_DOC_ID (el id del documento ya subido a Grid).
 *   3. Crear un disparador (trigger) de tipo "Basado en tiempo" que llame
 *      a dailyGridRefresh() una vez por día.
 *   4. Subir apps-script/OrdenesCompraTemplate.html como un archivo HTML
 *      más en este mismo proyecto de Apps Script (con ese nombre exacto).
 */
var GRID_DOC_ID = "01M1F26PZQMN55W9B3WD5BJFKE";
var GRID_API_BASE = "https://grid.adminml.com";

function dailyGridRefresh() {
  var html = buildOrdenesCompraHtml_();
  pushToGrid_(html);
}

function buildOrdenesCompraHtml_() {
  var result = getPurchaseRequests_();
  var template = HtmlService.createHtmlOutputFromFile("OrdenesCompraTemplate").getContent();
  var dataJs =
    "var EMBEDDED_AS_OF = " + JSON.stringify(new Date().toISOString()) + ";\n" +
    "var EMBEDDED_DATA = " + JSON.stringify(result.rows) + ";\n" +
    "var EMBEDDED_FX_BY_MONTH = " + JSON.stringify(result.fxByMonth) + ";";
  return template.replace("/*__EMBEDDED_DATA__*/", dataJs);
}

function pushToGrid_(html) {
  var token = PropertiesService.getScriptProperties().getProperty("GRID_TOKEN");
  if (!token) throw new Error('Falta configurar la propiedad de script "GRID_TOKEN" (token de Grid).');

  var blob = Utilities.newBlob(html, "text/html", "ordenes-compra.html");
  var resp = UrlFetchApp.fetch(GRID_API_BASE + "/api/v1/documents/" + GRID_DOC_ID + "/versions", {
    method: "post",
    headers: { Authorization: "Bearer " + token },
    payload: { file: blob },
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code >= 300) {
    throw new Error("Grid upload falló (" + code + "): " + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}
