# Verificador de Lineas 0.0.1 — candidato QA

Auditor de solo lectura para https://roversport.net/old.php en Firefox/Tampermonkey. NCAAB masculino, FT, pregame; ciclo de 5 min. No modifica ni envía líneas o apuestas. Instalar el archivo dist/Verificador-de-Lineas.user.js desde la rama de QA; no hay actualización automática hasta validar en Firefox real.

## Confirmación
- Spread/total >= 2 puntos; ML >= 20 unidades normalizadas (±100 equivalentes); inversión de favorito inmediata incluso por debajo del umbral. En ML ambos equipos pueden tener cuotas negativas.
- Rojo requiere misma dirección, mercado y tipo, dos plataformas diferentes y dos casas explícitamente identificadas diferentes. FOX tiene proveedor desconocido: solo evidencia amarilla. ESPN DraftKings + Covers DraftKings no confirma. Covers se consulta cuando falta confirmación, cobertura o una fuente; solo se aceptan nombres de casas reconocidos y datos con timestamp de los últimos 30 min. En caso de insuficiencia se queda amarillo/gris, nunca rojo por supuesto.
- ESPN y FOX se consultan agrupados. Covers usa HTML y abreviaturas corroboradas por la fuente con ID, fecha Today y hora exacta; coincidencias múltiples o no exactas se omiten. No se afirma independencia de proveedores de tecnología subyacentes; se distinguen operadores de líneas atribuidos. No se envían peticiones a casas ni se requiere clave de pago.
- Rover se consulta por GET /old.php en segundo plano, sin llamar al POST nativo optLogros.php. Se compara por ID del partido y equipos; si DOM local difiere, marca desactualización en lugar de pintar rojo sobre otro valor. El reloj de página permite verificar la fecha NY, no prueba edad exacta de cada línea. API ESPN/FOX no exponen timestamp de actualización por mercado en las respuestas analizadas.
- Mapa inicial 362 códigos de CBB EF Score, blob b3b7679f1d145744d1e128a25b13dff549d3bb31. Vinculación manual requiere confirmar IDs, no adivina por nombre. Historial IndexedDB 30 días, diagnóstico JSON, Excel local 4 hojas (FT) y notificaciones. Web Locks limita concurrencia, cache compartida; pausa y filtro son locales a pestaña. Firefox puede limitar audio sin gesto de usuario. SheetJS CE genera filtros y celdas numéricas; estilo avanzado y congelación no se garantizan.

## Reproducir
```sh
npm test
npm run check
npm run build
```

## Pendientes de aceptación
Pruebas reales con Tampermonkey/Firefox, reconstrucción del DOM, notificaciones, persistencia y apertura del XLSX. Covers HTML y timestamps son observados pero conector no ejecutado en Firefox en esta sesión. No instalar en producción sin verificar. Los tests unitarios se ejecutaron en V8 antes de publicar; Node/Firefox CI no verificado.

## Referencias
- https://www.tampermonkey.net/documentation.php
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- https://docs.sheetjs.com/docs/getting-started/installation/standalone/
- https://www.covers.com/sport/basketball/ncaab/odds
- https://github.com/Nox1do/rover-basketball/tree/main/CBB%20EF%20Score
