/**
 * Web App backend para el dashboard de Solicitudes (solicitudes.html).
 *
 * SETUP:
 * 1. Abrir la planilla "Solicitudes" (1mE-OctQbXEs6ZfdhH5R9WWO9VaVr0Rf5dS0MJunRYGE)
 *    -> Extensiones > Apps Script.
 * 2. Pegar TODO este archivo (reemplazando lo que haya).
 * 3. Implementar > Nueva implementacion > Tipo: Aplicacion web.
 *    - Ejecutar como: Yo (tu cuenta)
 *    - Quien tiene acceso: cualquier usuario con la cuenta de Google (o el
 *      publico si necesitas verlo sin login corporativo)
 * 4. Copiar la URL que te da y pegarla como API_URL en solicitudes.html.
 * 5. Cada vez que edites este script, tenes que crear una NUEVA implementacion
 *    (o "Administrar implementaciones" > editar > Nueva version) para que los
 *    cambios se vean en la URL publicada.
 *
 * Que hace:
 * - Lee la hoja "Solicitudes" de esta misma planilla.
 * - Excluye del dataset toda fila donde la columna "Solicitud" = "Retirada"
 *   o la columna "Status" = "RETIRADO".
 * - Convierte "Importe total" a USD usando la cotizacion de cierre del MES
 *   de "Periodo de servicio" (si esta vacio, usa el mes de "Marca temporal"),
 *   obtenida en vivo con GOOGLEFINANCE (dato real de Google Finance).
 * - Devuelve las filas ya limpias/convertidas para que el HTML agregue por
 *   mes/anio/solicitante en el navegador.
 */

var SPREADSHEET_ID = '1mE-OctQbXEs6ZfdhH5R9WWO9VaVr0Rf5dS0MJunRYGE';
var SHEET_NAME = 'Solicitudes';
var HEADER_ROW = 3; // fila con los nombres de columna reales
var FX_CACHE_SECONDS = 6 * 60 * 60; // 6 horas
var FX_SCRATCH_SHEET = '_fx_scratch';

function doGet(e) {
  var out;
  try {
    out = { ok: true, data: buildDashboardData(), generatedAt: new Date().toISOString() };
  } catch (err) {
    out = { ok: false, error: err && err.message ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildDashboardData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No se encontro la hoja "' + SHEET_NAME + '"');

  var values = sheet.getDataRange().getValues();
  var headers = values[HEADER_ROW - 1];
  var col = buildColumnIndex_(headers);

  var required = ['Marca temporal', 'En representación de usuario:', 'Importe total',
    'Moneda', 'Periodo de servicio', 'Solicitud', 'Status'];
  required.forEach(function (name) {
    if (col[name] === undefined) throw new Error('No se encontro la columna "' + name + '" en la fila de headers');
  });

  var rows = [];
  var excludedRetirada = 0;
  var invalidAmount = 0;

  for (var r = HEADER_ROW; r < values.length; r++) {
    var row = values[r];
    if (isBlankRow_(row)) continue;

    var solicitud = String(row[col['Solicitud']] || '').trim();
    var status = String(row[col['Status']] || '').trim();
    if (solicitud === 'Retirada' || status === 'RETIRADO') {
      excludedRetirada++;
      continue;
    }

    var marca = row[col['Marca temporal']];
    var periodo = row[col['Periodo de servicio']];
    var moneda = String(row[col['Moneda']] || '').trim().toUpperCase();
    var importeRaw = row[col['Importe total']];
    var importe = parseAmount_(importeRaw);
    if (importe === null) invalidAmount++;

    // "Periodo de servicio" a veces tiene errores de tipeo (ej. anio 2006 en vez de 2025);
    // si el anio no es plausible, usamos la fecha de la solicitud en su lugar.
    var periodoValido = (periodo instanceof Date) && periodo.getFullYear() >= 2020 && periodo.getFullYear() <= 2100;
    var periodDate = periodoValido ? periodo : (marca instanceof Date ? marca : null);

    rows.push({
      id: row[col['ID Vendor Management']] || '',
      marcaTemporal: (marca instanceof Date) ? marca.toISOString() : null,
      representante: String(row[col['En representación de usuario:']] || '').trim(),
      categoria: col['Categoría'] !== undefined ? String(row[col['Categoría']] || '').trim() : '',
      pais: col['País'] !== undefined ? String(row[col['País']] || '').trim() : '',
      importeOriginal: importe,
      moneda: moneda,
      periodoServicio: (periodDate instanceof Date) ? periodDate.toISOString() : null,
      solicitud: solicitud,
      status: status
    });
  }

  var fxCache = {};
  var fxMisses = {};
  rows.forEach(function (rec) {
    if (rec.importeOriginal === null || !rec.periodoServicio) {
      rec.importeUSD = null;
      return;
    }
    if (rec.moneda === 'USD' || rec.moneda === '') {
      rec.importeUSD = rec.importeOriginal;
      rec.fxRate = 1;
      return;
    }
    var d = new Date(rec.periodoServicio);
    var key = rec.moneda + '_' + d.getFullYear() + '_' + (d.getMonth() + 1);
    if (!(key in fxCache)) {
      fxCache[key] = getMonthEndRate_(rec.moneda, d.getFullYear(), d.getMonth() + 1);
    }
    var rate = fxCache[key];
    rec.fxRate = rate;
    if (rate === null) {
      rec.importeUSD = null;
      fxMisses[key] = (fxMisses[key] || 0) + 1;
    } else {
      rec.importeUSD = round2_(rec.importeOriginal * rate);
    }
  });

  return {
    rows: rows,
    meta: {
      totalFilas: values.length - HEADER_ROW,
      excluidasRetirada: excludedRetirada,
      montoInvalido: invalidAmount,
      fxNoDisponible: fxMisses
    }
  };
}

function buildColumnIndex_(headers) {
  var idx = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    if (h && idx[h] === undefined) idx[h] = i;
  }
  return idx;
}

function isBlankRow_(row) {
  for (var i = 0; i < row.length; i++) {
    if (row[i] !== '' && row[i] !== null) return false;
  }
  return true;
}

/** Convierte importes con formatos mixtos ("323.620,00", "125,528.53", 179997.2, "xxxx,xx") a Number, o null si no se puede. */
function parseAmount_(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  var s = String(raw).trim().replace(/[^0-9.,-]/g, '');
  if (!s) return null;

  var hasComma = s.indexOf(',') !== -1;
  var hasDot = s.indexOf('.') !== -1;

  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    var parts = s.split(',');
    s = (parts.length === 2 && parts[1].length <= 2) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot) {
    var partsD = s.split('.');
    if (partsD.length > 2) s = s.replace(/\./g, '');
  }

  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

/** Cotizacion de cierre (USD por 1 unidad de `currency`) del ultimo dia habil <= fin de mes, via GOOGLEFINANCE. Cacheada 6hs. */
function getMonthEndRate_(currency, year, month) {
  var cache = CacheService.getScriptCache();
  var key = 'fx_' + currency + '_' + year + '_' + month;
  var cached = cache.get(key);
  if (cached !== null) return cached === 'NA' ? null : parseFloat(cached);

  var rate = fetchMonthEndRateFromGoogleFinance_(currency, year, month);
  cache.put(key, rate === null ? 'NA' : String(rate), FX_CACHE_SECONDS);
  return rate;
}

function fetchMonthEndRateFromGoogleFinance_(currency, year, month) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var scratch = ss.getSheetByName(FX_SCRATCH_SHEET);
  if (!scratch) {
    scratch = ss.insertSheet(FX_SCRATCH_SHEET);
    scratch.hideSheet();
  }

  var today = new Date();
  var endOfMonth = new Date(year, month, 0); // ultimo dia del mes
  if (endOfMonth > today) endOfMonth = today; // periodo futuro/mal cargado -> usar la cotizacion mas reciente disponible
  var start = new Date(endOfMonth.getFullYear(), endOfMonth.getMonth(), endOfMonth.getDate());
  start.setDate(start.getDate() - 9); // ventana de 9 dias para saltear fines de semana/feriados

  var ticker = 'CURRENCY:' + currency + 'USD';
  var formula = '=GOOGLEFINANCE("' + ticker + '","close",DATE(' +
    start.getFullYear() + ',' + (start.getMonth() + 1) + ',' + start.getDate() + '),DATE(' +
    endOfMonth.getFullYear() + ',' + (endOfMonth.getMonth() + 1) + ',' + endOfMonth.getDate() + '))';

  scratch.getRange('A1').setFormula(formula);
  SpreadsheetApp.flush();
  Utilities.sleep(400);

  var values = scratch.getRange('A1:B15').getValues();
  scratch.getRange('A1:Z20').clearContent();

  for (var i = values.length - 1; i >= 0; i--) {
    var v = values[i][1];
    if (typeof v === 'number' && v > 0) return v;
  }
  return null;
}
