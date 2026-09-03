/**
 * Control de Pagos a Proveedores — PROYECTO NUEVO E INDEPENDIENTE.
 * No tiene ninguna relación con OrdenesCompraCode.gs / Dashboard.html (el
 * dashboard de Solicitudes de Orden de Compra que ya está en producción).
 * Va en su propia planilla de Google y su propio proyecto de Apps Script,
 * así se puede probar e iterar sin ningún riesgo de romper lo existente.
 *
 * Ver README.md ("Control de Pagos a Proveedores") para el setup completo
 * paso a paso (planilla, formulario, disparador).
 *
 * ─── Flujo ───────────────────────────────────────────────────────────────
 * 1. Alguien completa el Formulario "Carga de Soporte de Pago": elige el
 *    Proveedor de una lista y adjunta el soporte (excel, pdf, imagen del
 *    mail, lo que tenga). Monto/Servicio son opcionales.
 * 2. onFormSubmit(e) se dispara solo. Busca el Proveedor en la hoja
 *    "Maestro Proveedores" y, si lo encuentra, completa automáticamente
 *    Centro de Costo, Cuenta Contable, Sociedad y Usuario/Head habitual.
 * 3. Si el archivo adjunto es un Excel, intenta además extraer el Monto
 *    automáticamente (busca celdas tipo "Total"/"Monto"/"Importe"). Para
 *    PDF/imagen la extracción automática es experimental (ver
 *    extraerDePdfImagen_) y si falla no rompe nada: el monto queda en
 *    blanco para completarlo a mano una vez.
 * 4. Se agrega una fila a la hoja "Pagos" con todo lo resuelto. Si el
 *    Proveedor no estaba en el Maestro, la fila queda marcada "Falta
 *    clasificar" y se manda un mail de aviso — se completa una única vez
 *    en el Maestro y de ahí en adelante se autocompleta solo.
 * 5. Una vez cargado un Proveedor nuevo en el Maestro, correr
 *    "Pagos Proveedores > Reclasificar pendientes" (menú de la planilla)
 *    para que aplique retroactivamente a las filas que quedaron pendientes.
 */

var SHEET_MAESTRO = "Maestro Proveedores";
var SHEET_PAGOS = "Pagos";
var SHEET_ERRORES = "Errores";
var NOTIFY_EMAIL = "ailen.rojas@mercadolibre.com";

// Títulos exactos de las preguntas del Formulario de Google. Si se cambia el
// texto de una pregunta en el Form, hay que actualizarlo acá también.
var FORM_Q = {
  PROVEEDOR: "Proveedor",
  SERVICIO: "Servicio (opcional)",
  MONTO: "Monto (si lo sabés)",
  MONEDA: "Moneda (si la sabés)",
  MES: "Mes de pago"
};

var MAESTRO_HEADERS = [
  "Proveedor", "Servicio", "Centro de Costo", "Cuenta Contable",
  "Sociedad", "Moneda habitual", "Usuario habitual", "Head", "Notas"
];

var PAGOS_HEADERS = [
  "Fecha carga", "Proveedor", "Servicio", "Centro de Costo", "Cuenta Contable",
  "Sociedad", "Moneda", "Monto", "Origen del monto", "Mes de pago",
  "Estado", "Cargado por", "Link soporte", "Notas"
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Pagos Proveedores")
    .addItem("Reclasificar pendientes", "reclasificarPendientes")
    .addItem("Ver resumen del mes", "mostrarResumenMes")
    .addToUi();
}

/**
 * Disparador instalable: Extensiones > Apps Script > Disparadores >
 * Añadir disparador > función "onFormSubmit", evento "Al enviar formulario",
 * origen "Desde la hoja de cálculo".
 */
function onFormSubmit(e) {
  try {
    procesarRespuesta_(e);
  } catch (err) {
    registrarError_("onFormSubmit", err);
  }
}

function procesarRespuesta_(e) {
  var proveedor = String(getNamedValue_(e, FORM_Q.PROVEEDOR) || "").trim();
  var servicio = String(getNamedValue_(e, FORM_Q.SERVICIO) || "").trim();
  var montoInformado = normalizeAmount_(getNamedValue_(e, FORM_Q.MONTO));
  var monedaInformada = String(getNamedValue_(e, FORM_Q.MONEDA) || "").trim();
  var mesPago = String(getNamedValue_(e, FORM_Q.MES) || "").trim();
  var cargadoPor = (e.response && e.response.getRespondentEmail && e.response.getRespondentEmail()) || "";

  var fileIds = extraerFileIds_(e);
  var linkSoporte = fileIds.map(function (id) { return "https://drive.google.com/file/d/" + id + "/view"; }).join(", ");

  var extraido = { monto: null, moneda: null };
  if (!montoInformado && fileIds.length) {
    extraido = extraerDatosDeArchivos_(fileIds);
  }

  var monto = montoInformado != null ? montoInformado : extraido.monto;
  var moneda = monedaInformada || extraido.moneda || "";
  var origenMonto = montoInformado != null ? "Informado en el formulario"
    : (extraido.monto != null ? "Extraído automáticamente del soporte" : "Pendiente de revisión");

  var match = buscarEnMaestro_(proveedor, servicio);
  var estado = match ? "Clasificado" : "Falta clasificar";

  appendPago_({
    proveedor: proveedor,
    servicio: servicio,
    centroCosto: match ? match.centroCosto : "",
    cuentaContable: match ? match.cuentaContable : "",
    sociedad: match ? match.sociedad : "",
    moneda: moneda || (match ? match.monedaHabitual : ""),
    monto: monto,
    origenMonto: origenMonto,
    mesPago: mesPago,
    estado: estado,
    cargadoPor: cargadoPor,
    linkSoporte: linkSoporte,
    notas: ""
  });

  if (!match) notificarProveedorNuevo_(proveedor, servicio);
}

/** Busca Proveedor+Servicio en el Maestro; si no hay match exacto, prueba solo por Proveedor. */
function buscarEnMaestro_(proveedor, servicio) {
  var rows = sheetToObjects_(getOrCreateSheet_(SHEET_MAESTRO, MAESTRO_HEADERS));
  var pNorm = normalizarTexto_(proveedor);
  var sNorm = normalizarTexto_(servicio);
  if (!pNorm) return null;

  var candidatos = rows.filter(function (r) { return normalizarTexto_(r["Proveedor"]) === pNorm; });
  if (!candidatos.length) return null;

  var exacto = sNorm && candidatos.filter(function (r) { return normalizarTexto_(r["Servicio"]) === sNorm; });
  var elegido = (exacto && exacto.length) ? exacto[0] : candidatos[0];

  return {
    centroCosto: String(elegido["Centro de Costo"] || "").trim(),
    cuentaContable: String(elegido["Cuenta Contable"] || "").trim(),
    sociedad: String(elegido["Sociedad"] || "").trim(),
    monedaHabitual: String(elegido["Moneda habitual"] || "").trim(),
    usuarioHabitual: String(elegido["Usuario habitual"] || "").trim(),
    head: String(elegido["Head"] || "").trim()
  };
}

function normalizarTexto_(s) {
  return String(s || "").trim().toLowerCase();
}

function appendPago_(data) {
  var sheet = getOrCreateSheet_(SHEET_PAGOS, PAGOS_HEADERS);
  sheet.appendRow([
    new Date(),
    data.proveedor, data.servicio, data.centroCosto, data.cuentaContable,
    data.sociedad, data.moneda, data.monto, data.origenMonto, data.mesPago,
    data.estado, data.cargadoPor, data.linkSoporte, data.notas
  ]);
}

/**
 * Recorre "Pagos", vuelve a buscar en el Maestro las filas marcadas
 * "Falta clasificar" y completa Centro de Costo / Cuenta Contable / Sociedad
 * si ya se cargó el proveedor. Pensada para correr a mano desde el menú
 * después de completar el Maestro.
 */
function reclasificarPendientes() {
  var sheet = getOrCreateSheet_(SHEET_PAGOS, PAGOS_HEADERS);
  var values = sheet.getDataRange().getValues();
  var col = colMap_(values[0]);
  var actualizadas = 0;

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[col["Estado"]]).trim() !== "Falta clasificar") continue;

    var proveedor = String(row[col["Proveedor"]] || "").trim();
    var servicio = String(row[col["Servicio"]] || "").trim();
    var match = buscarEnMaestro_(proveedor, servicio);
    if (!match) continue;

    sheet.getRange(r + 1, col["Centro de Costo"] + 1).setValue(match.centroCosto);
    sheet.getRange(r + 1, col["Cuenta Contable"] + 1).setValue(match.cuentaContable);
    sheet.getRange(r + 1, col["Sociedad"] + 1).setValue(match.sociedad);
    sheet.getRange(r + 1, col["Estado"] + 1).setValue("Clasificado");
    actualizadas++;
  }

  SpreadsheetApp.getUi().alert(actualizadas
    ? "Se reclasificaron " + actualizadas + " fila(s)."
    : "No había filas pendientes que pudieran reclasificarse (revisá que el Proveedor en el Maestro esté escrito igual).");
}

function notificarProveedorNuevo_(proveedor, servicio) {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: "Proveedor sin clasificar: " + (proveedor || "(sin nombre)"),
    body:
      'Se cargó un soporte de pago de "' + proveedor + '"' + (servicio ? (" (servicio: " + servicio + ")") : "") +
      ' que no está en la hoja "Maestro Proveedores".\n\n' +
      "Completá Centro de Costo y Cuenta Contable para ese proveedor en el Maestro y después corré " +
      '"Pagos Proveedores > Reclasificar pendientes" desde el menú de la planilla para que se aplique ' +
      "también a este registro."
  });
}

/**
 * Extracción automática de Monto desde el/los archivo(s) adjuntos.
 * Solo soporta hojas de cálculo (Google Sheets / Excel) de forma confiable.
 * Para PDF/imagen ver extraerDePdfImagen_ (experimental).
 */
function extraerDatosDeArchivos_(fileIds) {
  for (var i = 0; i < fileIds.length; i++) {
    try {
      var file = DriveApp.getFileById(fileIds[i]);
      var mime = file.getMimeType();
      var resultado = null;

      if (mime === MimeType.GOOGLE_SHEETS ||
          mime === MimeType.MICROSOFT_EXCEL ||
          mime === MimeType.MICROSOFT_EXCEL_LEGACY ||
          mime === MimeType.CSV) {
        resultado = extraerDeHojaCalculo_(file);
      } else if (mime === MimeType.PDF || mime.indexOf("image/") === 0) {
        resultado = extraerDePdfImagen_(file);
      }

      if (resultado && resultado.monto != null) return resultado;
    } catch (err) {
      registrarError_("extraerDatosDeArchivos_", err);
    }
  }
  return { monto: null, moneda: null };
}

var ETIQUETAS_MONTO_ = /total|monto|importe/i;

function extraerDeHojaCalculo_(file) {
  var ss;
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    ss = SpreadsheetApp.openById(file.getId());
  } else {
    // Excel/CSV: Sheets los puede abrir directamente vía SpreadsheetApp
    // solo si ya están en formato Google; si no, se descarta (ver nota en README).
    return { monto: null, moneda: null };
  }

  var sheet = ss.getSheets()[0];
  var values = sheet.getDataRange().getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (typeof values[r][c] === "string" && ETIQUETAS_MONTO_.test(values[r][c])) {
        for (var c2 = c + 1; c2 < values[r].length; c2++) {
          var monto = normalizeAmount_(values[r][c2]);
          if (monto != null) return { monto: monto, moneda: null };
        }
      }
    }
  }
  return { monto: null, moneda: null };
}

/**
 * EXPERIMENTAL — requiere habilitar el servicio avanzado "Drive API" en el
 * proyecto (Servicios > + > Drive API). Convierte el PDF/imagen a Google Doc
 * (con OCR) para poder leerle el texto y buscar un monto. Si el servicio no
 * está habilitado o la conversión falla, devuelve null sin romper el flujo:
 * el registro se crea igual y el monto se completa a mano.
 */
function extraerDePdfImagen_(file) {
  var propHabilitado = PropertiesService.getScriptProperties().getProperty("OCR_HABILITADO");
  if (propHabilitado !== "true") return { monto: null, moneda: null };

  var tempDoc = null;
  try {
    var resource = { title: "OCR temporal - " + file.getName(), mimeType: MimeType.GOOGLE_DOCS };
    tempDoc = Drive.Files.copy(resource, file.getId(), { ocr: true, ocrLanguage: "es" });
    var texto = DocumentApp.openById(tempDoc.id).getBody().getText();
    var m = texto.match(/(?:total|monto|importe)[^\d]{0,15}([\d.,]+)/i);
    var monto = m ? normalizeAmount_(m[1]) : null;
    return { monto: monto, moneda: null };
  } catch (err) {
    registrarError_("extraerDePdfImagen_", err);
    return { monto: null, moneda: null };
  } finally {
    if (tempDoc && tempDoc.id) {
      try { Drive.Files.remove(tempDoc.id); } catch (err) {}
    }
  }
}

function extraerFileIds_(e) {
  var ids = [];
  try {
    if (e.response) {
      e.response.getItemResponses().forEach(function (ir) {
        if (ir.getItem().getType() === FormApp.ItemType.FILE_UPLOAD) {
          var resp = ir.getResponse();
          if (Array.isArray(resp)) ids = ids.concat(resp);
          else if (resp) ids.push(resp);
        }
      });
    }
  } catch (err) {
    registrarError_("extraerFileIds_", err);
  }
  return ids;
}

function getNamedValue_(e, title) {
  if (!e || !e.namedValues || !e.namedValues[title]) return "";
  return e.namedValues[title][0];
}

function normalizeAmount_(v) {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  var s = String(v).trim().replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  var hasComma = s.indexOf(",") !== -1;
  var hasDot = s.indexOf(".") !== -1;
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function colMap_(headerRow) {
  var col = {};
  headerRow.forEach(function (h, idx) { col[String(h).trim()] = idx; });
  return col;
}

function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    headers.forEach(function (h, idx) { obj[h] = values[r][idx]; });
    out.push(obj);
  }
  return out;
}

function registrarError_(origen, err) {
  try {
    var sheet = getOrCreateSheet_(SHEET_ERRORES, ["Fecha", "Origen", "Error"]);
    sheet.appendRow([new Date(), origen, err && err.message ? err.message : String(err)]);
  } catch (e) {}
  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: "Error en Control de Pagos a Proveedores (" + origen + ")",
      body: String(err && err.message ? err.message : err)
    });
  } catch (e) {}
}

/**
 * Resumen del mes en curso, agrupado por Centro de Costo — pensado para
 * responder "¿qué tenemos que pagar este mes?" de un vistazo. Expuesto al
 * Dashboard.html vía google.script.run y también a un alert simple desde
 * el menú (mostrarResumenMes).
 */
function getResumenMes() {
  var rows = sheetToObjects_(getOrCreateSheet_(SHEET_PAGOS, PAGOS_HEADERS));
  var now = new Date();
  var mesActual = (now.getMonth() + 1) + "/" + now.getFullYear();

  var delMes = rows.filter(function (r) {
    var fecha = r["Fecha carga"];
    if (!(fecha instanceof Date)) return false;
    return (fecha.getMonth() + 1) + "/" + fecha.getFullYear() === mesActual;
  });

  var pendientes = rows.filter(function (r) { return String(r["Estado"]).trim() === "Falta clasificar"; });

  var porCentroCosto = {};
  delMes.forEach(function (r) {
    var cc = String(r["Centro de Costo"] || "Sin clasificar").trim() || "Sin clasificar";
    if (!porCentroCosto[cc]) porCentroCosto[cc] = [];
    porCentroCosto[cc].push(r);
  });

  return {
    mes: mesActual,
    totalRegistros: delMes.length,
    pendientesDeClasificar: pendientes.length,
    porCentroCosto: porCentroCosto
  };
}

function mostrarResumenMes() {
  var r = getResumenMes();
  var lineas = Object.keys(r.porCentroCosto).map(function (cc) {
    return cc + ": " + r.porCentroCosto[cc].length + " pago(s)";
  });
  SpreadsheetApp.getUi().alert(
    "Resumen " + r.mes + "\n\n" +
    lineas.join("\n") +
    "\n\nPendientes de clasificar: " + r.pendientesDeClasificar
  );
}

/**
 * Dashboard web opcional (mismo patrón que el de Solicitudes de OC).
 * Setup: Implementar > Nueva implementación > Aplicación web.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle("Control de Pagos a Proveedores")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getDashboardData() {
  return getResumenMes();
}
