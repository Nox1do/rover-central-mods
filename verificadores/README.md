# Verificador de Lineas 0.0.8

Userscript para Firefox y Tampermonkey en la [página pública de líneas de Rover](https://roversport.net/old.php).

[Instalar o actualizar Rs - Verificador de Lineas](https://raw.githubusercontent.com/Nox1do/rover-central-mods/main/verificadores/Rs-Verificador-Lineas.user.js)

## Verificación

Con **BASKETBALL** visible, la verificación empieza cuando Rover carga la tabla. Revisa los partidos pregame de **NCAAB** cada cinco minutos mientras la página permanezca abierta (Firefox puede ralentizar los temporizadores en segundo plano). **Verificar ahora** ejecuta una revisión manual. La lectura de Rover se hace desde la tabla de la página.

| Mercado FT | Umbral | Regla |
|---|---:|---|
| Spread | 2 puntos | Diferencia en el mismo equipo de referencia. La inversión del favorito también se señala. |
| Over/Under | 2 puntos | Diferencia en el total del partido. |
| Moneyline | 20 puntos | Se compara cada equipo. +100 y −100 son equivalentes. La inversión del favorito también se señala. |

ESPN/DraftKings, FlashscoreUSA/bet365.us y FlashscoreUSA/BetMGM.us son las fuentes principales FT. FlashscoreUSA/DraftKings sirve como respaldo de la misma casa y nunca suma una confirmación adicional. H1 usa DraftKings, bet365.us y BetMGM.us. FOX se consulta si queda un mercado FT sin confirmar o incompleto y se muestra como referencia, sin contar como casa identificada. El rojo requiere dos casas identificadas que detecten una diferencia en el mismo sentido para el mismo mercado. Una señal sin confirmar se marca en ámbar; las alertas de ambos niveles pueden generar notificaciones de escritorio. La lista **Discrepancias** muestra los valores de Rover y de las fuentes que respondieron.

El cruce utiliza los códigos de equipo del mapa NCAAB, ambos equipos y la hora de inicio en Nueva York. El orden de equipos se ajusta por fuente. Un cruce ambiguo queda sin vincular. En Flashscore se toman selecciones activas de FT con prórroga. Si hay varias líneas con ambos lados activos, se toma la pareja con los precios más equilibrados.

## Descargar Lineas

El botón genera un archivo `.xlsx` con cuatro hojas.

| Hoja | Contenido |
|---|---|
| Lineas actuales | Foto de las filas cargadas por Rover, incluso las de secciones ocultas, con los equipos y las líneas publicadas en la tabla. |
| Discrepancias | Diferencias confirmadas y señales por revisar que corresponden a la foto. |
| Fuentes | Cuotas FT y H1 e identificadores de los partidos consultados. |
| Historial 30 dias | Cambios observados, primera diferencia, confirmación y resolución. |

El historial se conserva en IndexedDB durante 30 días en el perfil de Firefox y dominio donde se usa el script. Una resolución requiere dos referencias comparables dentro del umbral. La notificación se emite al detectar una nueva discrepancia amarilla y al confirmar una roja. IndexedDB conserva el estado de aviso por incidente para evitar repeticiones; una resolución permite volver a notificar. Al pulsar la notificación, Tampermonkey solicita resaltar la pestaña original y el script abre el modal y el evento correspondiente. El sistema operativo y Firefox gestionan la presentación y el foco.

## Interfaz 0.0.2

Panel aislado con Shadow DOM y Tailwind CSS 3.4.17 compilado, sin CDN ni Preflight global. Contadores por partido, tarjetas agrupadas por encuentro, comparación de mercados por columnas, nombres reales de equipos, filtros y panel plegable. Las fuentes, umbrales, verificación y exportación XLSX se conservan. Los contadores de alertas y datos incompletos pueden coincidir en un mismo encuentro.

Compilación reproducible: `npx tailwindcss@3.4.17 -c verificadores/ui/tailwind.config.cjs -i verificadores/ui/tailwind.css -o /tmp/rs-vl.css --minify`. Las pruebas de UI se ejecutan en Firefox headless mediante GitHub Actions, con datos simulados.

## Interfaz 0.0.3

Para inversiones de favorito en Spread o Moneyline, la tarjeta muestra el favorito de Rover y el de las fuentes que observan la inversión, sus logos originales (iniciales si no cargan), las cuotas individuales y, para Spread, un eje con Pick'em y la distancia en puntos. Moneyline muestra una sola vista por partido aunque ambos lados estén afectados. Las discrepancias normales mantienen la tabla. Una inversión solo se presenta en rojo si dos fuentes que sustentan el hallazgo confirman la inversión; si una sola la detecta, se muestra en ámbar incluso si el mercado tiene otra discrepancia confirmada. No cambia la evaluación ni notificación preexistente del motor.

## Interfaz 0.0.4

Botón azul suave VERIFICADOR junto a SOCCER, reinsertado cuando Rover reconstruye su barra. Modal nativo accesible con controles, métricas, filtros y lista de eventos desplegables. Conserva la vista de inversiones, exportación e historial. Alertas amarillas y rojas con acceso al evento desde la notificación. Verificación en segundo plano mientras la página siga cargada; no funciona con Firefox cerrado o la pestaña descargada. QA simula la API de Tampermonkey, por lo que el foco real de Windows 10 se valida en la sesión del usuario.

## Interfaz 0.0.5

El botón aparece únicamente cuando Rover carga la barra deportiva y al menos uno de sus botones es visible. Se coloca después de SOCCER cuando existe, replica las dimensiones, tipografía y márgenes del botón nativo visible y conserva el azul suave. ResizeObserver sincroniza cambios de tamaño y el observador de Rover vuelve a insertarlo tras reconstrucciones. No se crea un botón temporal fuera de la barra.

## Mercados 0.0.6 (histórico)

FT conserva ESPN/DraftKings, FlashscoreUSA/bet365 y FOX condicional. H1 usa bet365, bwin y William Hill, tres casas identificadas en la misma respuesta de FlashscoreUSA (scope FIRST_HALF). No se incorpora SportsbookReview ni se realizan peticiones adicionales por evento. Spread y total H1: umbral de 1 punto; Moneyline: 20 unidades; inversiones válidas sin umbral. Dos casas con discrepancia en la misma dirección confirman; una sola deja amarillo. Los mercados de dos resultados HOME_AWAY no se mezclan con HOME_DRAW_AWAY ni DRAW_NO_BET. No se garantiza independencia de infraestructura ni vigencia individual de cada cuota (la respuesta no expone timestamp comprobado por selección).

Rover publica H1 spread/total; Moneyline H1 se muestra desde fuentes externas como informativo hasta que Rover publique una columna ML H1 explícita. H1 y FT se separan en pestañas, avisos, historial y columnas XLSX. Se añade la pestaña H1 en el evento cuando existe su mercado Rover. Si una casa no tiene cuota comparable, aparece —. La exportación conserva los datos crudos de Rover, incluido H1, y separa los campos externos por periodo. Validación real 26/11/2026: muestra de 12 partidos con bet365 y William Hill spread/total 12/12, bwin spread 11/12 y total 12/12; Moneyline de dos resultados bet365 y bwin 12/12, William Hill 0/12. Disponibilidad variable.

## Fuentes 0.0.7

FlashscoreUSA consulta el catálogo US/NJ (`projectId=130`, `geoIpCode=US`, `geoIpSubdivisionCode=USNJ`) una sola vez por evento. H1: DraftKings, bet365.us y BetMGM.us, siempre FIRST_HALF. FT: ESPN/DraftKings prioritario, bet365.us y BetMGM.us; Flashscore/DraftKings se muestra y sirve de respaldo únicamente en mercados FULL_TIME_OVER_TIME. El feed observado publica Spread/Total DraftKings bajo FULL_TIME, por lo que no se equiparan a FT con prórroga sin verificar la semántica del proveedor. DraftKings nunca cuenta dos veces por mercado; si ESPN tiene el dato, Flashscore/DraftKings es informativo. FOX conserva su consulta condicional como referencia, pero no confirma independientemente (su API no identifica la casa). Para confirmar rojo se requieren dos casas identificadas con diferencias del mismo signo. Los nombres antiguos de fuentes se conservan en XLSX para el historial 30 días. No cambia el intervalo ni los umbrales. La respuesta usa un mismo agregador, por lo que no se presume independencia de infraestructura ni frescura por cuota. Los parámetros regionales no implican disponibilidad de servicios de apuestas ni garantizan acceso desde toda ubicación. QA valida parser con datos reales y navegador con fixtures; el acceso desde Tampermonkey del usuario requiere prueba local.

## Interfaz 0.0.8

Dos controles compactos de solo icono junto a Eventos y resultados expanden o contraen los detalles de todos los eventos del filtro activo. Conservan el estado de los eventos fuera del filtro y la pestaña FT/H1 seleccionada. Los controles se deshabilitan cuando no hay eventos que expandir o contraer y tienen nombres accesibles y tooltips.

## Versiones

- **0.0.8** — Iconos para expandir y contraer todos los eventos visibles.

- **0.0.7** — Catálogo US/NJ, H1 con DraftKings, bet365.us y BetMGM.us; deduplicación por casa y exclusión de scopes incompatibles.

- **0.0.6** — H1 con tres casas de FlashscoreUSA y umbrales separados.

- **0.0.5** — Corrección de posición y dimensiones del botón VERIFICADOR durante carga y actualización.

- **0.0.4** — Modal, lista desplegable, alertas amarillas y activación de la pestaña original.

- **0.0.3** — Vista especial para inversiones de favorito FT, con logos y evidencia por fuente.

- **0.0.2** — Rediseño de interfaz y botones; no cambia el motor de verificación.

- **0.0.1** — Verificación pregame de NCAAB, confirmación por dos fuentes, historial local y exportación de líneas.
