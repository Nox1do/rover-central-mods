# Verificador de Lineas 0.0.1

Userscript para Firefox y Tampermonkey en la [página pública de líneas de Rover](https://roversport.net/old.php).

[Instalar o actualizar Rs - Verificador de Lineas](https://raw.githubusercontent.com/Nox1do/rover-central-mods/main/verificadores/Rs-Verificador-Lineas.user.js)

## Verificación

Con **BASKETBALL** visible, la verificación empieza cuando Rover carga la tabla. Revisa los partidos pregame de **NCAAB** cada cinco minutos mientras la pestaña está activa. **Verificar ahora** ejecuta una revisión manual. La lectura de Rover se hace desde la tabla de la página.

| Mercado FT | Umbral | Regla |
|---|---:|---|
| Spread | 2 puntos | Diferencia en el mismo equipo de referencia. La inversión del favorito también se señala. |
| Over/Under | 2 puntos | Diferencia en el total del partido. |
| Moneyline | 20 puntos | Se compara cada equipo. +100 y −100 son equivalentes. La inversión del favorito también se señala. |

ESPN/DraftKings y FlashscoreUSA/bet365 son las fuentes principales. FOX se consulta si queda un mercado sin confirmar o con datos incompletos. El color rojo y la notificación de escritorio requieren dos fuentes distintas que detecten una diferencia en el mismo sentido para el mismo mercado. Una señal sin confirmar se marca en ámbar. La lista **Discrepancias** muestra los valores de Rover y de las fuentes que respondieron.

El cruce utiliza los códigos de equipo del mapa NCAAB, ambos equipos y la hora de inicio en Nueva York. El orden de equipos se ajusta por fuente. Un cruce ambiguo queda sin vincular. En Flashscore se toman selecciones activas de FT con prórroga. Si hay varias líneas con ambos lados activos, se toma la pareja con los precios más equilibrados.

## Descargar Lineas

El botón genera un archivo `.xlsx` con cuatro hojas.

| Hoja | Contenido |
|---|---|
| Lineas actuales | Foto de las filas cargadas por Rover, incluso las de secciones ocultas, con los equipos y las líneas publicadas en la tabla. |
| Discrepancias | Diferencias confirmadas y señales por revisar que corresponden a la foto. |
| Fuentes | Cuotas FT e identificadores de los partidos consultados. |
| Historial 30 dias | Cambios observados, primera diferencia, confirmación y resolución. |

El historial se conserva en IndexedDB durante 30 días en el perfil de Firefox y dominio donde se usa el script. Una resolución requiere dos referencias comparables dentro del umbral. La notificación se emite al confirmar la discrepancia. Si está disponible, la notificación vuelve a la pestaña y abre la lista.

## Versiones

- **0.0.1** — Verificación pregame de NCAAB, confirmación por dos fuentes, historial local y exportación de líneas.
