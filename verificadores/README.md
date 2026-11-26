# Verificador de Lineas 0.0.5

Userscript para Firefox y Tampermonkey en la [página pública de líneas de Rover](https://roversport.net/old.php).

[Instalar o actualizar Rs - Verificador de Lineas](https://raw.githubusercontent.com/Nox1do/rover-central-mods/main/verificadores/Rs-Verificador-Lineas.user.js)

## Verificación

Con **BASKETBALL** visible, la verificación empieza cuando Rover carga la tabla. Revisa los partidos pregame de **NCAAB** cada cinco minutos mientras la página permanezca abierta (Firefox puede ralentizar los temporizadores en segundo plano). **Verificar ahora** ejecuta una revisión manual. La lectura de Rover se hace desde la tabla de la página.

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

## Versiones

- **0.0.5** — Corrección de posición y dimensiones del botón VERIFICADOR durante carga y actualización.

- **0.0.4** — Modal, lista desplegable, alertas amarillas y activación de la pestaña original.

- **0.0.3** — Vista especial para inversiones de favorito FT, con logos y evidencia por fuente.

- **0.0.2** — Rediseño de interfaz y botones; no cambia el motor de verificación.

- **0.0.1** — Verificación pregame de NCAAB, confirmación por dos fuentes, historial local y exportación de líneas.
