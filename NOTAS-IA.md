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
