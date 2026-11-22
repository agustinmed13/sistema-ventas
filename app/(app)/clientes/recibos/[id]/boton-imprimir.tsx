'use client';
// Botón "Imprimir" del recibo (RF-C5: el recibo es imprimible).
//
// Es CLIENT COMPONENT porque window.print() existe solo en el navegador:
// abre el cuadro de impresión (o "Guardar como PDF").

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BotonImprimir() {
  return (
    <Button onClick={() => window.print()}>
      <Printer />
      Imprimir
    </Button>
  );
}
