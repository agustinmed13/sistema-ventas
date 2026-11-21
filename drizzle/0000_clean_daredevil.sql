CREATE TABLE `categorias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`activa` integer DEFAULT true NOT NULL,
	`creada_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categorias_nombre_unique` ON `categorias` (`nombre`);--> statement-breakpoint
CREATE TABLE `clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo_documento` text NOT NULL,
	`numero_documento` text NOT NULL,
	`nombre` text NOT NULL,
	`domicilio` text,
	`telefono` text,
	`email` text,
	`cuenta_corriente_habilitada` integer DEFAULT false NOT NULL,
	`limite_credito_centavos` integer,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clientes_documento_unico` ON `clientes` (`tipo_documento`,`numero_documento`);--> statement-breakpoint
CREATE TABLE `factura_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`factura_id` integer NOT NULL,
	`producto_id` integer NOT NULL,
	`descripcion` text NOT NULL,
	`cantidad` integer NOT NULL,
	`precio_unitario_centavos` integer NOT NULL,
	`subtotal_centavos` integer NOT NULL,
	FOREIGN KEY (`factura_id`) REFERENCES `facturas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`producto_id`) REFERENCES `productos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `facturas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`punto_venta` integer DEFAULT 1 NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`cliente_id` integer,
	`usuario_id` integer NOT NULL,
	`total_centavos` integer NOT NULL,
	`forma_pago` text NOT NULL,
	`tarjeta_tipo` text,
	`tarjeta_marca` text,
	`tarjeta_ultimos4` text,
	`monto_recibido_centavos` integer,
	`estado` text DEFAULT 'emitida' NOT NULL,
	`motivo_anulacion` text,
	`anulada_en` text,
	`anulada_por_id` integer,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`anulada_por_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facturas_numero_unico` ON `facturas` (`punto_venta`,`numero`);--> statement-breakpoint
CREATE TABLE `movimientos_cuenta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`importe_centavos` integer NOT NULL,
	`fecha` text NOT NULL,
	`descripcion` text NOT NULL,
	`factura_id` integer,
	`pago_id` integer,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`factura_id`) REFERENCES `facturas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pago_id`) REFERENCES `pagos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `movimientos_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`producto_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`cantidad` integer NOT NULL,
	`existencia_resultante` integer NOT NULL,
	`motivo` text NOT NULL,
	`fecha` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`factura_id` integer,
	FOREIGN KEY (`producto_id`) REFERENCES `productos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`factura_id`) REFERENCES `facturas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pagos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero_recibo` integer NOT NULL,
	`cliente_id` integer NOT NULL,
	`fecha` text NOT NULL,
	`importe_centavos` integer NOT NULL,
	`medio` text NOT NULL,
	`observacion` text,
	`usuario_id` integer NOT NULL,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pagos_numero_recibo_unique` ON `pagos` (`numero_recibo`);--> statement-breakpoint
CREATE TABLE `productos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo` text NOT NULL,
	`descripcion` text NOT NULL,
	`categoria_id` integer NOT NULL,
	`precio_centavos` integer NOT NULL,
	`existencia` integer DEFAULT 0 NOT NULL,
	`stock_minimo` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `productos_codigo_unique` ON `productos` (`codigo`);--> statement-breakpoint
CREATE TABLE `sesiones` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` integer NOT NULL,
	`expira_en` text NOT NULL,
	`creada_en` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`nombre` text NOT NULL,
	`contrasena_hash` text NOT NULL,
	`rol` text NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_email_unique` ON `usuarios` (`email`);