# Errores de la IA y cómo los corregimos

## 21/11 — Imports con extensión .js después de pasar a TypeScript

Qué pasó: al convertir el proyecto a TypeScript, el agente dejó los imports
como '@/db/index.js'. TypeScript no marcaba ningún error, pero Next no
encontraba los archivos y toda la API respondía 500.

Cómo lo detectamos: arrancando npm run dev. El chequeo de tipos no alcanzaba.

Cómo se corrigió: quitando la extensión, '@/db/index'.

Qué aprendimos: que compile no quiere decir que funcione. Hay que probar
ejecutando, no solo verificando tipos.