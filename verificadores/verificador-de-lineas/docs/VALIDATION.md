# Validación inicial

- PASS: Rover favorito segunda posición
- PASS: Rover favorito primera posición
- PASS: Rover nulos
- PASS: Rover no interpreta total como spread
- PASS: Pickem sin inversión
- PASS: ML ambos negativos
- PASS: ML normaliza cruce
- PASS: Normal
- PASS: Spread diferencia exacta 2
- PASS: Total diferencia 1.5
- PASS: Dos plataformas proveedor desconocido no rojo
- PASS: Dos proveedores independientes
- PASS: Mismo proveedor no rojo
- PASS: Direcciones contrarias no rojo
- PASS: Mercados distintos no rojo
- PASS: Inversión ML ambos negativos
- PASS: Una fuente correcta no verde
- PASS: Sin ML sí verificar otros
- PASS: NY fecha y DST
- PASS: Rover fecha
- PASS: Identidad invertida por IDs
- PASS: Evento ambiguo excluido
- PASS: Evento iniciado excluido
- PASS: Fecha distinta excluida
- PASS: Equipo sin equivalencia excluido
- PASS: Excel snapshot usa líneas actuales

Pruebas ejecutadas directamente en V8 antes de crear el commit. Integración Firefox/Tampermonkey pendiente; no se afirma que haya pasado.

## Segunda revisión

- 29 pruebas unitarias pasaron en V8, incluyendo frescura de Rover.
- Adapters publicados probados con respuestas reales HTTP 200 de ESPN y FOX: ESPN 20 pregame completos, FOX 20 pregame completos. Oklahoma-Purdue IDs ESPN 401906807 y FOX 264833; spread +4.5/-4.5 y total 140.5 en ambos. Se verificó que los parsers extraen ML por equipo.
- Corrección de alertas visuales en fallos parciales: el fallo de una fuente no invalida una confirmación de otras dos.
- Se validó sintaxis de la distribución con compilación de V8. Prueba de navegador real pendiente.
