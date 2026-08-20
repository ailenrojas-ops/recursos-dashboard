/**
 * Backend para el Dashboard de Solicitudes de Orden de Compra.
 * Pegar este código en Extensiones > Apps Script del Google Sheet
 * (el mismo spreadsheet que contiene la solapa de "Respuestas"),
 * y publicarlo como Web App (Implementar > Nueva implementación > Aplicación web):
 *   - Ejecutar como: Yo
 *   - Quién tiene acceso: Cualquier usuario de mercadolibre.com (o el que corresponda)
 * Luego copiar la URL /exec resultante en ordenes-compra.html (variable API_URL).
 */

function doGet(e) {
  try {
    var fx = getFxRates_();
    var data = getPurchaseRequests_(fx);
    return jsonOutput_({ ok: true, data: data, fx: { rates: fx.rates, asOf: fx.asOf, source: fx.source } });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message });
  }
}

// Tipos de cambio de referencia (unidades de moneda local por 1 USD),
// usados solo si falla la consulta a la API en vivo. Actualizar cada tanto.
var FALLBACK_RATES_ = { MXN: 18.5, BRL: 5.6, ARS: 1000, USD: 1 };

function getFxRates_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("fxRates");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  var result = null;
  try {
    var resp = UrlFetchApp.fetch("https://open.er-api.com/v6/latest/USD", { muteHttpExceptions: true });
    var json = JSON.parse(resp.getContentText());
    if (json && json.result === "success" && json.rates) {
      result = { rates: json.rates, asOf: json.time_last_update_utc || new Date().toISOString(), source: "live" };
    }
  } catch (err) {
    // sin conexión o API caída: se usa el fallback
  }
  if (!result) {
    result = { rates: FALLBACK_RATES_, asOf: "Tipo de cambio de referencia (sin conexión a API en vivo)", source: "fallback" };
  }
  result.rates.USD = 1;
  try { cache.put("fxRates", JSON.stringify(result), 21600); } catch (e) {} // 6 hs
  return result;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function findResponsesSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (/respuesta/i.test(sheets[i].getName())) return sheets[i];
  }
  return sheets[0];
}

function getPurchaseRequests_(fx) {
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
    var rate = fx.rates[moneda];
    var importeUsd = (importe != null && rate) ? importe / rate : null;

    out.push({
      id: idNum,
      fecha: fechaDate.toISOString(),
      email: String(get(row, "Dirección de correo electrónico") || "").trim(),
      usuario: String(get(row, "En representación de usuario:") || "").trim(),
      titulo: String(get(row, "Título de solicitud") || "").trim(),
      categoria: String(get(row, "Categoría") || "").trim(),
      proveedor: cleanProveedor_(String(get(row, "Proveedor") || "").trim()),
      importe: importe,
      moneda: moneda,
      importeUsd: importeUsd,
      head: String(get(row, "HEAD") || "").trim() || "Sin asignar",
      status: String(get(row, "Status") || "").trim() || "Sin status",
      oc: String(get(row, "OC") || "").trim(),
      pr: String(get(row, "PR") || "").trim()
    });
  }
  return out;
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
