# Errores de la IA y cómo los corregimos

## 21/11 — Imports con extensión .js después de pasar a TypeScript

Qué pasó: al convertir el proyecto a TypeScript, el agente dejó los imports
como '@/db/index.js'. TypeScript no marcaba ningún error, pero Next no
encontraba los archivos y toda la API respondía 500.

Cómo lo detectamos: arrancando npm run dev. El chequeo de tipos no alcanzaba.

Cómo se corrigió: quitando la extensión, '@/db/index'.

Qué aprendimos: que compile no quiere decir que funcione. Hay que probar
ejecutando, no solo verificando tipos.

## 21/11 — Renombramos la API y quedó una pantalla hablando el idioma viejo

Qué pasó: adaptamos la API de facturas a los nombres de campo de la consigna
(sección 11.6): la forma de pago pasó a ir anidada dentro de "pago" y el
importe pasó de "montoRecibidoCentavos" a "montoRecibido". El agente cambió
el servicio y la parte de la pantalla que LEE la respuesta, pero se olvidó
de la parte que ARMA el pedido. La pantalla seguía mandando
{ clienteId, formaPago, items, montoRecibidoCentavos }.

Cómo lo detectamos: probando una venta real en el navegador. Todo andaba
(cliente, buscador, total) y al confirmar salía el cartel
'El campo "formaPago" no se puede enviar.' Ese mensaje lo genera nuestro
propio servicio, que rechaza los campos que no conoce.

Cómo se corrigió: en app/(app)/ventas/nueva/page.tsx, armando el cuerpo con
la forma nueva: { clienteId, items, pago: { forma, montoRecibido, tarjeta } }.

Qué aprendimos: un cambio de contrato de la API toca TRES lugares, no uno:
el servicio que valida, el código que manda el pedido y el código que lee la
respuesta. Si se cambian dos de los tres, el error no aparece al compilar:
aparece recién al usar la pantalla. Y nos sirvió de prueba de que la
validación del servidor funciona: rechazó un pedido mal armado en lugar de
ignorar el campo en silencio.

## 21/11 — El alta de clientes volvió a decidir cómo se guarda el documento (Majo)

Qué pasó: al adaptar clientes a la sección 5.1, el agente hizo que el alta
guardara el número de documento tal como llegaba, con puntos ("28.456.123").
Pero esa decisión ya estaba tomada en otro lugar: lib/formato.ts dice que en
la base el documento se guarda SIN puntos ni guiones, y formatearDocumento()
se los agrega al mostrarlo. El alta la volvió a decidir por su cuenta, y
distinto. La regla quedó en dos lugares que no coincidían.

Por qué importa: además de mostrarse mal, el índice único de la base compara
textos, y para la base "28.456.123" y "28456123" son distintos. Si entraban
los dos, la misma persona quedaba cargada dos veces sin que saltara
DOCUMENTO_DUPLICADO.

Cómo lo detectamos: leyendo lib/formato.ts mientras escribíamos los pagos,
no por un error en pantalla. El cliente de prueba "Mariana López" había
quedado guardado con puntos.

Cómo se corrigió: en lib/servicios/clientes.ts, validarDatosCliente() limpia
el documento con limpiarDocumento() antes de guardarlo. Está en el SERVICIO,
no en el formulario, así que vale igual para el alta y la edición, y aunque
alguien le pegue directo a la API. Además, verificarDocumentoUnico() compara
los documentos sin puntos, por si quedaba alguna fila vieja. Mariana se
corrigió con un PATCH y verificamos en la base que no queda ninguna fila con
puntos ni guiones.

Qué aprendimos: el error no fue "guardar puntos", fue tener la misma regla
decidida en dos lugares (punto 7 de la lista de control de la sección 10.8:
cada regla vive en un solo lugar). Antes de decidir cómo se guarda un dato,
hay que buscar si el proyecto ya lo decidió.

## 21/11 — Comandos de prueba que no funcionaban: comillas de bash y un campo inventado

Qué pasó: para probar GET /api/productos, el agente pasó comandos curl de
login con dos errores. (1) Usaban comillas simples '{"email":...}', que
funcionan en bash pero no en cmd.exe de Windows: el JSON llegaba cortado y
el servidor respondía 400 JSON_INVALIDO. (2) Mandaban el campo "password",
cuando nuestro login espera "contrasena". El agente asumió el nombre en vez
de leer app/api/auth/login/route.ts.

Cómo se corrigió: en cmd, el JSON va entre comillas dobles y las de adentro
se escapan con \" ; y se usa el campo "contrasena".

Qué aprendimos: el agente no tiene que suponer nombres de campo, ni siquiera
en un comando de prueba: tiene que leerlos del código. Es la misma regla de
la sección 5.1 ("no inventar"). Y el 400 JSON_INVALIDO mostró que la ruta de
login valida bien un cuerpo roto.

## 21/11 — Categorías: un código RF inventado y datos basura en la base compartida

Qué pasó (1): al escribir el servicio de categorías, el agente comentó
"RF-P4" sin verificarlo. En db/schema.ts las categorías son RF-P7 (RF-P4 es
el ingreso de stock). Lo detectó el mismo agente buscando los códigos RF en
el repo, antes de entregar.

Qué pasó (2): al probar el alta de categorías con curl, los acentos llegaron
mal codificados y se guardó "Categor�a de prueba" (el carácter de reemplazo
U+FFFD). Por eso la prueba de nombre duplicado "pasó" sin detectar nada: comparaba
contra un nombre roto. Quedaron 4 categorías basura en la base de Turso que
usa todo el grupo.

Cómo se corrigió: se cambió RF-P4 por RF-P7. Las categorías basura (ids 11 a
14, sin productos) se borraron después de verificar que nada las usaba. Las
pruebas con acentos se repitieron desde Node (fetch manda UTF-8 siempre) y
ahí el duplicado sí dio 409 NOMBRE_DUPLICADO.

Qué aprendimos: una prueba que "da bien" también puede estar mal armada.
Si un resultado sorprende (un duplicado que no se detecta), hay que mirar
los datos guardados, no solo la respuesta. Y probar contra una base
compartida deja rastros: conviene usar nombres que se reconozcan como prueba.
