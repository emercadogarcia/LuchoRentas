# PRD — LuchoRentas
## Sistema simple de administración y control de rentas de casas y cuartos

---

## Control documental

| Campo | Definición |
|---|---|
| Producto | LuchoRentas |
| Documento | Product Requirements Document (PRD) |
| Versión | 1.1 |
| Estado | PRD revisado; reglas operativas cerradas y una validación contractual residual |
| Fecha | 19-11-2026 |
| Creador | Edgar Mercado |
| Marca / organización | 3MGLabs.com |
| WhatsApp de contacto | +59170203103 |
| Mercado inicial | Bolivia |
| Idioma | Español |
| Zona horaria | America/La_Paz |
| Monedas | BOB y USD; conversión manual, explícita y trazable |
| Plataforma | Aplicación web responsive, priorizando escritorio y móvil |
| Alcance | Administración de alquileres de casas completas y cuartos, cobranza, gastos, caja y reportes |

## Índice

1. Resumen ejecutivo
2. Problema a resolver
3. Objetivos y criterios de éxito
4. Contexto y reglas del negocio
5. Stakeholders y permisos
6. Alcance
7. Priorización MoSCoW
8. Requerimientos funcionales
9. Requerimientos no funcionales
10. Arquitectura técnica propuesta
11. Consideraciones de entorno y despliegue
12. Riesgos y mitigaciones
13. Dependencias y decisiones
14. KPIs
15. Matriz de trazabilidad
16. Entregables
17. Plan de trabajo y factibilidad
18. Criterios de aceptación y validación final
19. Feedback y validación final

---

# 1. Resumen ejecutivo

### 1.1 Ejecutivo
LuchoRentas permitirá que una persona o pequeño administrador controle una o varias casas y sus cuartos, registre inquilinos, propietarios y proveedores, genere cuentas por cobrar de alquiler, registre cobros y gastos, emita recibos descargables y revise ingresos, egresos y saldos.

La aplicación será multi-tenant: cada tenant tendrá sus propios usuarios, inmuebles, personas y movimientos. Los datos de un tenant no serán visibles para otro. Dentro de cada tenant, el propietario de la cuenta tendrá acceso total a sus datos; los demás usuarios solo accederán a las funciones y registros autorizados.

### 1.2 Técnico
Se propone una aplicación web responsive con React + TypeScript + Vite, Supabase Auth y PostgreSQL con Row Level Security (RLS). La base de datos será la fuente única de verdad. Las operaciones financieras críticas se ejecutarán de forma transaccional en PostgreSQL.

### 1.3 Operativo
El flujo principal será: configurar tenant y usuarios → registrar casas y modalidad de alquiler → registrar personas → configurar contratos y periodicidad → generar cuentas por cobrar → registrar cobros y emitir recibos → registrar gastos y pagos → revisar caja, arqueos y reportes.

# 2. Problema a resolver

La administración de alquileres puede depender de anotaciones, hojas de cálculo y cálculos manuales separados. Esto dificulta conocer cuánto se debe cobrar, qué unidades están ocupadas, quién está en mora, cuánto se gastó en cada casa y cuál es el resultado financiero por inmueble o propietario.

LuchoRentas centraliza esos procesos con formularios sencillos, generación controlada de obligaciones, recibos numerados y trazabilidad de movimientos.

## 2.1 Resultados esperados
- Consultar rápidamente cobros, saldos pendientes, gastos y ocupación.
- Administrar más de una casa desde un mismo tenant.
- Alquilar una casa completa o dividirla en cuartos.
- Evitar cuentas por cobrar duplicadas.
- Mantener separados los datos de distintos tenants.
- Identificar ingresos y egresos por casa y, cuando corresponda, por propietario.

# 3. Objetivos y criterios de éxito

| ID | Objetivo | Criterio de éxito | Validación |
|---|---|---|---|
| OBJ-01 | Administrar varias casas por tenant | El propietario puede crear y consultar múltiples casas | Prueba funcional |
| OBJ-02 | Controlar alquiler completo o por cuarto | Cada casa permite configurar una modalidad y sus unidades alquilables | Prueba de configuración y ocupación |
| OBJ-03 | Controlar cuentas por cobrar | Cada período elegible genera una obligación única por contrato/unidad | Prueba de idempotencia |
| OBJ-04 | Registrar cobros y emitir recibos | Cada cobro confirmado genera recibo correlativo descargable en PDF e imagen | Prueba de cobranza |
| OBJ-05 | Registrar gastos y pagos | Cada egreso queda asociado a categoría y, cuando corresponda, casa/unidad y proveedor | Prueba financiera |
| OBJ-06 | Revisar caja y resultados | Los totales pueden revisarse por período, casa y propietario | Conciliación de reportes |
| OBJ-07 | Aislar información | Ningún usuario de otro tenant puede consultar datos ajenos | Pruebas RLS negativas |

Las metas numéricas comerciales y sus horizontes se definirán después del piloto, cuando exista una línea base real; no se inventan objetivos.

# 4. Contexto y reglas del negocio

## 4.1 Modelo de tenant

- Un tenant es el espacio privado de trabajo de una persona o negocio que administra alquileres.
- Un tenant puede registrar y administrar varias casas.
- Un usuario puede pertenecer a uno o más tenants mediante membresías independientes.
- El usuario selecciona el tenant activo al ingresar o cambiar de espacio de trabajo.
- Los registros de negocio siempre pertenecen a un tenant.
- Un tenant no puede consultar, modificar, descargar ni inferir datos de otro tenant.
- El propietario del tenant tiene acceso total a los datos de su tenant, incluyendo usuarios, casas, personas y movimientos.
- Los usuarios colaboradores solo acceden a las funciones y datos autorizados por sus permisos.
- El propietario externo de una casa no obtiene acceso al sistema automáticamente por estar registrado como contacto. Solo tendrá acceso si posteriormente se habilita y autoriza una cuenta de usuario.

## 4.2 Casas y unidades alquilables

Cada casa podrá configurarse con una de estas modalidades:

1. **Casa completa:** la casa constituye una única unidad alquilable.
2. **Por cuartos:** la casa contiene una o más unidades/ cuartos independientes, cada uno con su propio estado, inquilino, tarifa y contrato.

Reglas:
- Una casa configurada como alquiler completo no podrá tener contratos activos simultáneos por sus cuartos.
- Una casa configurada por cuartos podrá tener varios cuartos ocupados por distintos inquilinos.
- No se permitirá ocupar dos veces la misma unidad durante períodos incompatibles.
- La modalidad y estructura de alquiler se configurarán antes de activar contratos. Cambios posteriores deberán validar contratos y ocupación vigentes.
- Cada unidad tendrá identificador/nombre, estado, tarifa de referencia opcional y observaciones.
- Estados mínimos: disponible, ocupada y fuera de servicio. El estado ocupado se deriva de contratos activos; no debe poder contradecirlos manualmente.

## 4.3 Personas y relaciones

Una ficha de persona podrá desempeñar uno o varios roles:
- Inquilino.
- Propietario de inmueble.
- Proveedor.
- Contacto u otro.

Datos básicos: nombre/razón social, tipo de persona, documento de identidad o NIT cuando corresponda, teléfono, WhatsApp, correo, dirección y observaciones. Los campos obligatorios definitivos se detallarán en UX; no se exigirá información que no sea necesaria para operar.

Una persona puede ser propietario de una o varias casas y también proveedor o inquilino, si corresponde. Las relaciones se registran separadamente de la ficha de persona.

## 4.4 Contrato y generación de alquiler

Cada contrato relacionará:
- Casa y, si aplica, cuarto/unidad.
- Inquilino responsable.
- Fecha de inicio y fecha de finalización, si existe.
- Importe de alquiler y moneda.
- Frecuencia de generación de la cuenta por cobrar.
- Día de vencimiento.
- Fecha de inicio del primer período de cobro.
- Estado y observaciones.

Para el alcance inicial, la frecuencia principal será mensual. El sistema generará la cuenta por cobrar al inicio de cada período mensual configurado, mediante un proceso automático diario e idempotente. También existirá una acción manual autorizada para generar o recuperar un período, mostrando una vista previa y evitando duplicados.

La periodicidad mensual se calculará por aniversario del inicio contractual. Ejemplo: inicio 15/01 genera período 15/01–14/02 y el siguiente 15/02–14/03. Se aplicará prorrateo por días reales: importe del período dividido entre los días calendario del período contractual y multiplicado por los días efectivamente cubiertos. El sistema mostrará período, divisor, días cobrados e importe antes de confirmar. La obligación vence al inicio del período; la mora es informativa desde el día siguiente y no genera intereses ni multas automáticas. La generación diaria será idempotente, transaccional y protegida contra concurrencia; no habrá generación histórica automática.

Para contratos iniciados los días 29, 30 o 31, la versión 1.1 propone conservar el día ancla original, usar el último día disponible en meses cortos y recuperar el ancla original en el mes siguiente. Esta convención requiere aprobación expresa antes de activar contratos con esas fechas, porque afecta el período facturable.

No se generarán cargos históricos retroactivos automáticamente. Las regularizaciones anteriores se registrarán mediante una acción manual autorizada y auditada.

## 4.5 Cuentas por cobrar

- Cada cuenta por cobrar identifica contrato, casa, unidad, inquilino, período, fecha de emisión, vencimiento, importe, moneda y saldo.
- Estados derivados: pendiente, parcialmente pagada, pagada y vencida.
- Un pago parcial reduce el saldo, sin cerrar la obligación mientras exista saldo.
- El sistema no duplicará una obligación para el mismo contrato/unidad y período.
- El saldo se calculará desde obligaciones, aplicaciones de pagos y reversiones; no se editará manualmente.
- La mora será informativa desde el día siguiente al vencimiento. No se aplicarán intereses ni multas automáticas en el alcance inicial.
- El usuario autorizado podrá registrar ajustes o anulaciones con motivo y trazabilidad; nunca se borrará silenciosamente una obligación con movimientos asociados.

## 4.6 Cobros y recibos

Cada cobro registrará:
- Fecha y hora efectiva del cobro.
- Inquilino y obligación o cuenta de alquiler a la que se aplica.
- Casa y cuarto, cuando corresponda.
- Monto y moneda.
- Método de pago: efectivo, transferencia u otro método configurable.
- Usuario que registró/recibió el cobro.
- Observación opcional.
- Referencia o comprobante opcional.

Reglas:
- Se permitirán pagos completos y parciales.
- El sistema mostrará el saldo y la aplicación antes de confirmar.
- El monto aplicado no podrá superar el saldo de la obligación ni el importe recibido.
- El excedente se registrará como crédito separado y no se aplicará automáticamente. Su aplicación posterior requerirá acción autorizada y auditada.
- El cobro confirmado será inmutable. Las correcciones se harán mediante reversión vinculada y motivo.
- Cada cobro confirmado generará un recibo interno correlativo por tenant y tipo de documento. El contador se asignará transaccionalmente para impedir duplicados y evitar huecos por reintentos de una misma operación.
- El recibo incluirá número, fecha/hora, administrador/tenant, inquilino, inmueble/unidad, importe y moneda, método de pago, concepto/período y leyenda visible de comprobante interno no fiscal.
- El recibo podrá visualizarse, descargarse como PDF y descargarse como imagen. La emisión se confirma junto con el cobro; el renderizado posterior del archivo no vuelve a emitir el recibo.
- La numeración será asignada en backend dentro de una transacción para evitar duplicados en cobros concurrentes.

## 4.7 Cuentas por pagar y gastos

El módulo permitirá registrar gastos asociados a:
- Casa completa.
- Cuarto/unidad específica.
- Gasto general del tenant, cuando no corresponda a una casa concreta.

Categorías iniciales:
- Energía eléctrica.
- Agua potable.
- Internet.
- Mantenimiento/reparación.
- Limpieza.
- Otros.

Cada gasto registrará concepto, categoría, proveedor opcional, casa/unidad opcional, fecha del gasto, vencimiento si aplica, importe, moneda, observación y evidencia/documento opcional.

El registro, aprobación y pago del gasto serán eventos diferenciados:
- Pendiente de aprobación.
- Aprobado pendiente de pago.
- Parcialmente pagado.
- Pagado.
- Anulado/revertido con motivo.

El sistema permitirá registrar pagos parciales o totales a proveedores y servicios, con fecha/hora, monto, moneda, método, usuario y referencia. Cada pago confirmado reduce el saldo y genera egreso efectivo en la caja correspondiente. Un gasto aprobado pero no pagado no genera egreso ni reduce el resultado de caja hasta que se confirme el pago.

## 4.8 Caja, arqueo y conciliación

- Cada usuario operativo mantiene una caja independiente por tenant y moneda.
- La caja contempla apertura, movimientos, arqueo, conciliación y cierre.
- La apertura registra usuario, fecha/hora, saldo inicial y moneda.
- Cobros y pagos confirmados se vinculan a la caja y moneda correspondientes. No se permiten movimientos en cajas cerradas.
- El arqueo compara saldo esperado con saldo contado por moneda. Toda diferencia requiere motivo, evidencia cuando corresponda y aprobación autorizada.
- Una caja cerrada no se reabre ni edita. Las correcciones se registran como movimientos compensatorios en la caja/período vigente, vinculados al original.
- Los movimientos financieros confirmados son inmutables y auditables.
- No se compensan monedas distintas dentro de una misma caja.

## 4.9 Propietarios y resultado financiero

Una casa podrá ser propia del administrador o administrada para uno o varios propietarios externos.

- Se asociarán una o varias personas propietarias a la casa.
- Las participaciones y sus fechas de vigencia se conservarán históricamente. Cuando existan copropietarios, la suma de participaciones vigentes para un período debe ser 100%.
- El MVP mostrará reportes informativos por casa y propietario: alquileres cobrados, gastos pagados y resultado operativo, separados por moneda.
- El MVP no calcula comisiones de administración, no distribuye fondos ni genera liquidaciones formales. Cualquier pago al propietario se registra como egreso manual con beneficiario, inmueble, moneda, fecha, método y evidencia.
- El propietario externo no obtiene acceso al sistema por estar asociado a una casa.

# 5. Stakeholders y permisos

| Rol | Responsabilidad | Participación |
|---|---|---|
| Propietario del tenant | Control total del espacio, casas, usuarios, configuración y finanzas | Administración total |
| Administrador | Gestiona casas, contratos, personas, cuentas, cobros y gastos según permisos | Operación |
| Cobrador | Consulta cuentas y registra cobros; no administra configuración sensible | Cobranza |
| Operador financiero | Registra gastos, pagos, caja y arqueos según permisos | Finanzas |
| Consulta | Accede únicamente a reportes y datos autorizados | Solo lectura |
| Propietario externo | Contacto/beneficiario asociado a una casa; sin acceso de usuario por defecto | Sin acceso al sistema |
| Administrador SaaS | Soporte técnico/comercial de la plataforma; sin acceso ordinario al contenido financiero de tenants | Administración de plataforma |

## 5.1 Reglas de autorización

- El propietario del tenant siempre puede consultar todos los datos de su tenant.
- Los permisos de colaboradores se asignan por tenant y se validan en backend.
- Los permisos pueden limitarse por módulo/acción y por casa; la autorización efectiva debe cumplir ambos alcances.
- Un usuario sin membresía activa no accede al tenant.
- El rol de propietario externo no equivale al rol de propietario del tenant.
- El personal SaaS no tendrá acceso rutinario a datos de negocio. Cualquier acceso excepcional de soporte deberá ser autorizado, limitado, justificado y auditado.
- Desactivar un usuario revoca su acceso, pero conserva el historial de acciones realizadas.

# 6. Alcance

## 6.1 Incluido en el MVP

- Registro e inicio de sesión.
- Creación de tenant y propietario principal.
- Gestión de usuarios, membresías y permisos básicos.
- Aislamiento estricto multi-tenant.
- Registro de casas y configuración de alquiler completo o por cuartos.
- Registro y gestión de unidades/cuarto.
- Registro de inquilinos, propietarios y proveedores.
- Asociación de propietarios a casas.
- Contratos de alquiler mensuales por aniversario, con prorrateo real.
- Configuración de importe, fecha de inicio, vencimiento y frecuencia de generación.
- Generación automática y manual controlada de cuentas por cobrar.
- Consulta de saldos y morosidad.
- Registro de cobros completos y parciales.
- Recibos con numeración automática y descarga PDF/imagen.
- Registro de gastos y cuentas por pagar.
- Registro de pagos parciales y totales de gastos/proveedores.
- Dashboard minimalista oscuro con filtro global Mes/Año.
- Movimientos recientes de cobros y pagos.
- Cajas independientes por usuario y moneda, con apertura, arqueo, conciliación y cierre.
- Reportes financieros por período, casa y propietario.
- Auditoría de acciones financieras críticas.

## 6.2 Excluido del MVP

- Facturación fiscal electrónica.
- Contabilidad general de doble partida.
- Declaraciones o reportes tributarios.
- Pasarelas de pago y cobro online.
- Integración oficial con WhatsApp Business API.
- Portal de autoservicio para inquilinos o propietarios.
- Firma electrónica de contratos.
- Publicación de inmuebles en portales.
- Reservas turísticas, alquiler diario o administración hotelera.
- Periodicidades de cobro diaria o semanal.
- Conversión cambiaria automática o consolidación multimoneda.
- Portal de autoservicio para propietarios externos.
- Gestión de condominios y expensas.
- Gestión de depósitos de garantía, custodia, devolución y deducciones.
- Comisiones y liquidaciones formales a propietarios.
- Inteligencia artificial.
- Aplicación móvil nativa.

# 7. Priorización MoSCoW

| Prioridad | Funcionalidades | Justificación |
|---|---|---|
| Must Have | Tenant/RLS, usuarios, casas, cuartos, personas, contratos mensuales, CxC, cobros, recibos, gastos, pagos, dashboard y reportes básicos | Sin estas funciones no existe control operativo de rentas |
| Should Have | Arqueos formales, adjuntos de comprobantes, filtros avanzados y exportación CSV/PDF de reportes | Mejoran control y evidencia, pero pueden entregarse después del flujo central |
| Could Have | Recordatorios por correo, plantillas personalizadas de recibos, historial documental de contratos | Mejoras de productividad |
| Won’t Have | Facturación fiscal, IA, pasarela online, portal de inquilinos, contabilidad formal | Fuera del objetivo mínimo y del MVP solicitado |

# 8. Requerimientos funcionales

Prioridad: Must salvo indicación distinta. Los criterios de aceptación se identifican como CA.

## 8.1 Identidad, tenant y usuarios

| ID | Requerimiento | Actor | Flujo esperado | Criterio de aceptación |
|---|---|---|---|---|
| RF-001 | Registrar usuario e iniciar sesión | Usuario | Registro/autenticación y acceso a sus tenants | CA-001: un usuario no autenticado no accede a datos privados |
| RF-002 | Crear tenant | Usuario creador | Crear espacio y quedar como propietario | CA-002: el creador queda como propietario principal |
| RF-003 | Aislar datos por tenant | Sistema | Aplicar tenant activo y políticas RLS | CA-003: un tenant no puede leer ni modificar registros de otro |
| RF-004 | Administrar usuarios y permisos | Propietario | Invitar/activar/desactivar usuarios y asignar permisos | CA-004: los permisos se aplican también en consultas y operaciones backend |
| RF-005 | Cambiar tenant activo | Usuario con varias membresías | Seleccionar espacio autorizado | CA-005: el cambio no mezcla datos ni conserva consultas del tenant anterior |

## 8.2 Casas y cuartos

| ID | Requerimiento | Actor | Flujo esperado | Criterio de aceptación |
|---|---|---|---|---|
| RF-010 | Registrar casa | Propietario/Administrador | Capturar nombre, dirección, descripción y modalidad | CA-010: la casa queda vinculada al tenant activo |
| RF-011 | Configurar modalidad de alquiler | Propietario/Administrador | Seleccionar casa completa o por cuartos | CA-011: la modalidad determina las unidades que pueden contratarse |
| RF-012 | Registrar cuartos | Propietario/Administrador | Crear unidades con nombre/código y características básicas | CA-012: cada cuarto pertenece a una sola casa y tenant |
| RF-013 | Consultar ocupación | Usuario autorizado | Ver estado de casa y unidades | CA-013: la ocupación se deriva de contratos vigentes |
| RF-014 | Impedir doble ocupación | Sistema | Validar intervalos antes de activar contrato | CA-014: no se confirman contratos incompatibles concurrentes |

## 8.3 Personas y contratos

| ID | Requerimiento | Actor | Flujo esperado | Criterio de aceptación |
|---|---|---|---|---|
| RF-020 | Registrar personas | Propietario/Administrador | Crear ficha y asignar uno o varios roles | CA-020: una persona puede ser inquilino, proveedor y/o propietario |
| RF-021 | Asociar propietario a casa | Propietario/Administrador | Seleccionar persona y relación de propiedad | CA-021: se puede consultar qué casas corresponden a cada propietario |
| RF-022 | Crear contrato de alquiler | Administrador | Seleccionar casa/unidad, inquilino, tarifa, fechas y vencimiento | CA-022: no se activa un contrato sin datos esenciales |
| RF-023 | Definir alquiler mensual | Administrador | Configurar monto, moneda y ciclo mensual | CA-023: el calendario de períodos se previsualiza antes de activar |
| RF-024 | Modificar condiciones futuras | Administrador autorizado | Crear nueva versión con fecha de vigencia | CA-024: cargos ya emitidos conservan sus valores originales |
| RF-025 | Finalizar contrato | Administrador autorizado | Registrar fecha efectiva y motivo | CA-025: no se borran cargos ni pagos previos y se libera ocupación según fecha efectiva |

## 8.4 Cuentas por cobrar y cobros

| ID | Requerimiento | Actor | Flujo esperado | Criterio de aceptación |
|---|---|---|---|---|
| RF-030 | Generar CxC mensual automática | Sistema | Job diario detecta períodos que inician y crea obligaciones | CA-030: reejecutar el proceso no duplica cargos |
| RF-031 | Generar CxC manual | Administrador autorizado | Elegir contrato/período, previsualizar y confirmar | CA-031: el sistema bloquea períodos ya generados |
| RF-032 | Consultar cuentas por cobrar | Usuario autorizado | Filtrar por mes, casa, cuarto, inquilino y estado | CA-032: saldo = importe de obligación menos pagos aplicados y ajustes |
| RF-033 | Registrar cobro | Cobrador/Administrador | Seleccionar cuenta, ingresar fecha/hora, monto, método y observación | CA-033: se registra quién cobró y el saldo se actualiza correctamente |
| RF-034 | Registrar pago parcial | Cobrador/Administrador | Ingresar importe menor al saldo | CA-034: la cuenta queda parcialmente pagada con saldo correcto |
| RF-035 | Emitir recibo correlativo | Sistema | Crear recibo en la misma transacción del cobro | CA-035: no hay recibos duplicados incluso con cobros simultáneos |
| RF-036 | Descargar recibo | Usuario autorizado | Abrir recibo y descargar PDF o imagen | CA-036: ambos formatos muestran los mismos datos y numeración |
| RF-037 | Revertir cobro | Usuario autorizado | Indicar motivo y confirmar reversión | CA-037: se conserva el original y se registra movimiento inverso auditado |

## 8.5 Cuentas por pagar, gastos y pagos

| ID | Requerimiento | Actor | Flujo esperado | Criterio de aceptación |
|---|---|---|---|---|
| RF-040 | Registrar gasto | Administrador/Operador financiero | Capturar concepto, categoría, casa/unidad, proveedor, importe y vencimiento | CA-040: el gasto queda asociado al tenant y a su ámbito |
| RF-041 | Administrar categorías | Propietario/Administrador | Usar categorías iniciales y crear otras | CA-041: las categorías se filtran por tenant |
| RF-042 | Consultar CxP | Usuario autorizado | Filtrar por período, proveedor, casa, categoría y estado | CA-042: se distinguen gastos pendientes y pagados |
| RF-043 | Registrar pago de gasto | Operador financiero autorizado | Seleccionar gasto e ingresar fecha/hora, monto y método | CA-043: solo el pago confirmado genera egreso de caja |
| RF-044 | Registrar proveedor | Propietario/Administrador | Crear y consultar ficha de proveedor | CA-044: proveedor queda aislado dentro del tenant |
| RF-045 | Adjuntar comprobante | Usuario autorizado | Cargar archivo asociado a gasto o pago | CA-045: archivo privado, validado y accesible solo con permiso |

## 8.6 Dashboard, caja y reportes

| ID | Requerimiento | Actor | Flujo esperado | Criterio de aceptación |
|---|---|---|---|---|
| RF-050 | Mostrar dashboard | Usuario autorizado | Abrir panel con filtro global Mes/Año | CA-050: todas las métricas y tablas usan el mismo período |
| RF-051 | Mostrar KPIs financieros | Usuario autorizado | Consultar cobros, CxC, CxP y ocupación | CA-051: cada KPI coincide con sus consultas de detalle |
| RF-052 | Mostrar indicadores operativos | Usuario autorizado | Consultar casas/unidades, ocupadas, libres y morosos | CA-052: no se cuentan unidades fuera de servicio como libres |
| RF-053 | Mostrar movimientos recientes | Usuario autorizado | Ver tablas compactas de cobros y pagos | CA-053: cada fila muestra datos y fecha del movimiento |
| RF-054 | Consultar ingresos y egresos | Usuario autorizado | Filtrar movimientos por período, casa y categoría | CA-054: los totales coinciden con los movimientos confirmados |
| RF-055 | Realizar arqueo | Usuario con permiso financiero | Comparar saldo esperado y contado, registrar diferencia | CA-055: diferencia requiere explicación y queda auditada |
| RF-056 | Reporte por casa | Propietario/Usuario autorizado | Consultar cobros, CxC, gastos y resultado por casa | CA-056: los importes coinciden con el libro de movimientos |
| RF-057 | Reporte por propietario | Propietario/Usuario autorizado | Consultar casas asociadas e ingresos/gastos atribuibles | CA-057: no se atribuyen montos sin relación de propiedad definida |
| RF-058 | Exportar reportes | Usuario autorizado | Descargar información filtrada | CA-058: exportación respeta tenant y permisos |

## 8.7 Reglas transversales

- Toda operación financiera debe guardar usuario, fecha/hora, tenant y referencia de origen.
- El frontend no será autoridad para calcular saldos ni asignar permisos.
- Los importes se almacenarán con tipo decimal exacto, nunca punto flotante.
- Los registros financieros confirmados no se eliminarán físicamente.
- Los procesos automáticos deberán ser idempotentes.
- Las operaciones concurrentes deberán proteger correlativos y saldos.
- Las consultas y exportaciones deberán respetar el tenant activo y los permisos.

# 9. Dashboard y experiencia de usuario

## 9.1 Estilo general

- Diseño minimalista en modo oscuro.
- Interfaz responsive, con prioridad de lectura rápida.
- Navegación lateral o menú compacto.
- Formularios cortos, con valores predeterminados y selección contextual de casa/unidad.
- Acciones frecuentes visibles: registrar cobro, registrar gasto y revisar cuentas pendientes.
- Evitar gráficos decorativos que no aporten decisiones operativas.

## 9.2 Filtro global

En la parte superior se mostrará un filtro global:
- Mes.
- Año.
- Valor inicial: mes y año actuales según zona horaria del tenant.

Al cambiar el filtro se recalcularán las tarjetas KPI, indicadores operativos que dependan del período y tablas de movimientos. El filtro no modificará datos; solo el alcance temporal de la consulta.

## 9.3 Bloque 1 — Fila financiera: cuatro tarjetas KPI

1. **Cobros realizados en el período:** suma de cobros confirmados cuya fecha efectiva pertenece al mes/año seleccionado.
2. **Cuentas por cobrar:** saldo pendiente de las obligaciones de alquiler correspondientes al período seleccionado. Debe diferenciar saldo pendiente no vencido y vencido en el detalle.
3. **Cuentas por pagar:** saldo pendiente de gastos registrados cuyo vencimiento/período corresponde al filtro. El detalle debe permitir identificar gastos vencidos.
4. **Porcentaje de ocupación general:** unidades alquilables ocupadas / unidades alquilables habilitadas × 100. Para casas completas se cuenta una unidad; para casas por cuartos se cuentan los cuartos habilitados. Se excluyen unidades fuera de servicio.

Cada tarjeta permite abrir el listado que compone su total.

## 9.4 Bloque 2 — Fila operativa de unidades: cuatro micro-indicadores

1. Total de casas/unidades alquilables.
2. Unidades ocupadas.
3. Unidades libres.
4. Cantidad de inquilinos morosos.

La ocupación se calcula al último día del mes seleccionado. Cobros y pagos se agrupan por fecha efectiva del mes; saldos CxC/CxP se calculan al cierre del mes. La morosidad considera obligaciones vencidas con saldo pendiente al cierre. Todos los importes se muestran separados por moneda. Una persona con varias obligaciones vencidas se cuenta una sola vez.

## 9.5 Bloque 3 — Movimientos recientes: dos tablas compactas

### Últimos cobros realizados

Columnas:
- Inquilino.
- Casa.
- Fecha y hora.
- Monto.

### Últimos pagos realizados

Columnas:
- Concepto/Servicio.
- Categoría.
- Fecha y hora.
- Monto.

Las tablas mostrarán los movimientos más recientes dentro del período seleccionado, ordenados del más nuevo al más antiguo. Cada tabla mostrará hasta 5 filas en la vista inicial y permitirá abrir la lista completa filtrada.

# 10. Requerimientos no funcionales

## 10.1 Seguridad y privacidad
- Autenticación obligatoria.
- RLS activado en todas las tablas expuestas.
- Validación de membresía activa y permisos en backend.
- `tenant_id` no será confiado desde el cliente; se verificará contra la identidad y membresía.
- Relaciones y claves foráneas deberán impedir vínculos entre tenants.
- Archivos privados con autorización por tenant y enlaces temporales.
- Protección contra enumeración de identificadores y acceso directo a archivos.
- Secretos y claves privilegiadas nunca se incluirán en frontend.
- Acciones sensibles y financieras auditadas.

## 10.2 Integridad financiera
- Transacciones atómicas para confirmar cobros, aplicaciones, recibos y movimientos.
- Transacciones atómicas para confirmar pagos de gastos y egresos.
- Correlativos protegidos frente a concurrencia.
- Saldos derivados de movimientos confirmados.
- Reversiones compensatorias; no borrar operaciones confirmadas.
- Idempotencia en generación automática de cuentas por cobrar.

## 10.3 Rendimiento
Las metas cuantitativas de rendimiento se establecerán con la carga real prevista antes de producción. Las consultas agregadas se ejecutarán en PostgreSQL y los listados usarán paginación. Las consultas del dashboard deberán usar agregaciones en base de datos e índices adecuados, evitando descargar grandes volúmenes al navegador.

## 10.4 Disponibilidad, backup y recuperación
- Backups independientes y procedimiento de restauración documentados.
- Objetivos operativos: RPO máximo 24 horas y RTO máximo 8 horas; no constituyen garantía contractual.
- Probar restauración antes de producción, al menos anualmente y después de cambios importantes.
- Registrar errores de procesos automáticos y permitir reintentos controlados.

## 10.5 Auditoría
Registrar como mínimo:
- Inicio/cierre de sesión y cambios de membresía relevantes.
- Altas y cambios de casas, unidades, personas y contratos.
- Generación de cuentas por cobrar.
- Cobros, recibos, reversiones y ajustes.
- Gastos, pagos, arqueos y cierres.
- Cambios de permisos y configuración.

# 11. Arquitectura técnica propuesta

La arquitectura se mantiene simple y alineada con la referencia inmobiliaria v5.3: React + TypeScript + Vite, Supabase Auth, PostgreSQL, RLS, funciones transaccionales en PostgreSQL y Supabase Storage privado. La referencia define PostgreSQL como fuente transaccional única y exige RLS y RPC para operaciones críticas. Esta versión reduce el dominio a rentas residenciales, sin incorporar los módulos SaaS/inmobiliarios avanzados que no son necesarios para el MVP. Referencia: PRD Maestro Inmobiliario v5.3, stack y separación de responsabilidades.

## 11.1 Componentes

| Capa | Tecnología propuesta | Responsabilidad |
|---|---|---|
| Frontend | React + TypeScript + Vite | Pantallas, formularios, filtros y dashboard |
| Autenticación | Supabase Auth | Identidad y sesión |
| Base de datos | PostgreSQL en Supabase | Datos y transacciones |
| Seguridad de datos | PostgreSQL RLS | Aislamiento tenant y permisos |
| Lógica crítica | PostgreSQL RPC | Cobros, recibos, cargos, pagos, arqueos y validaciones |
| Archivos | Supabase Storage privado | Comprobantes y documentos |
| Procesos programados | Supabase Scheduled Functions/cron, mecanismo compatible por confirmar | Generación diaria de cuentas por cobrar |
| Documentos | Generación de PDF e imagen desde servicio confiable | Recibos descargables |

## 11.2 Entidades principales

- `profiles`: identidad de usuario y datos de perfil.
- `tenants`: espacios de trabajo.
- `tenant_memberships`: relación usuario-tenant, estado y rol.
- `roles` / `permissions`: permisos por tenant.
- `people`: personas y datos de contacto.
- `person_roles`: roles de negocio de cada persona.
- `properties`: casas.
- `property_units`: unidad alquilable; para casa completa se crea una unidad lógica única.
- `property_owners`: relación casa-propietario y participación opcional.
- `tenants_renters` o relación equivalente: se recomienda evitar duplicar personas; el inquilino se referencia desde `people`.
- `rental_contracts`: contratos.
- `rental_contract_versions`: historial de tarifas y condiciones.
- `receivable_charges`: cuentas por cobrar.
- `payments`: cobros recibidos.
- `payment_allocations`: aplicaciones de cobros a obligaciones.
- `receipts`: recibos correlativos.
- `expense_categories`: categorías de gasto.
- `expenses`: gastos/cuentas por pagar.
- `expense_payments`: pagos de gastos.
- `cash_movements`: entradas y salidas confirmadas.
- `cash_accounts`, `cash_sessions` y `cash_reconciliations`: cajas por usuario/moneda, sesiones y arqueos.
- `attachments`: metadatos de archivos.
- `audit_logs`: historial de acciones críticas.

Todas las entidades operativas incluirán `tenant_id`, UUID, fechas de creación/actualización y referencias tenant-safe. No se permitirá relacionar registros de tenants diferentes.

## 11.3 RPC y procesos críticos

Como mínimo:
- `create_tenant`.
- `create_property` / `update_property_rental_mode`.
- `create_rental_contract` / `activate_rental_contract`.
- `generate_rent_charges`.
- `confirm_rent_payment`.
- `issue_rent_receipt`.
- `reverse_rent_payment`.
- `create_expense`.
- `confirm_expense_payment`.
- `open_cash_session`, `record_cash_reconciliation` y `close_cash_session`.
- `export_tenant_report`.

Cada operación validará identidad, membresía, permisos, tenant, estado, datos y reglas de negocio. Las funciones privilegiadas deberán fijar `search_path` y conceder privilegios mínimos.

## 11.4 Reglas de datos

- UUID como identificador técnico.
- `tenant_id` obligatorio en datos de negocio.
- FKs compuestas o validaciones equivalentes para evitar referencias cruzadas entre tenants.
- Importes con `NUMERIC/DECIMAL`.
- Fechas almacenadas de forma consistente y presentadas en `America/La_Paz`.
- Índices por tenant, fechas, estados y claves de relación.
- Soft delete para datos maestros cuando corresponda; no eliminación física de movimientos financieros confirmados.
- Historial de cambios para contratos y tarifas.

# 12. Consideraciones de entorno y despliegue

| Entorno | Uso | Datos |
|---|---|---|
| DEV | Desarrollo individual y pruebas técnicas | Datos ficticios |
| TEST/QA | Pruebas funcionales, RLS y financieras | Datos ficticios |
| STAGING | Validación previa a producción | Datos anonimizados o ficticios |
| PROD | Operación real | Datos de clientes |

Requisitos:
- Separar proyectos/credenciales por entorno.
- Versionar migraciones SQL, políticas RLS y funciones RPC en Git.
- Ejecutar pruebas automáticas antes de desplegar.
- No modificar manualmente producción como mecanismo ordinario.
- Producción requiere aprobación humana.
- Mantener procedimiento de rollback mediante migraciones compatibles o compensatorias.

# 13. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fuga de datos entre tenants | Exposición de información privada | RLS por tabla, claves tenant-safe y pruebas negativas automatizadas |
| Duplicación de alquiler mensual | Saldos incorrectos | Clave única por contrato/unidad/período e idempotencia |
| Doble ocupación de una casa/cuarto | Conflictos con inquilinos | Validación transaccional de intervalos y concurrencia |
| Recibos duplicados | Problemas de control y confianza | Correlativo generado en transacción y restricción única |
| Diferencia entre caja y movimientos | Reportes financieros incorrectos | Libro de movimientos inmutable y arqueo con justificación |
| Gasto registrado como pagado sin salida real | Egresos incorrectos | Separar registro de gasto y confirmación de pago |
| Cambio de tarifa altera meses anteriores | Historial financiero inconsistente | Versionado de contrato y snapshot en cada obligación |
| Dashboard muestra cifras no conciliadas | Decisiones incorrectas | Definiciones únicas de KPI y pruebas contra detalle |
| Complejidad prematura | Mayor costo y demora | Mantener fuera del MVP contabilidad formal, portal, IA e integraciones no solicitadas |

# 14. Dependencias y decisiones

## 14.1 Dependencias
- Proyecto Supabase y credenciales separadas por entorno.
- Dominio y hosting del frontend.
- Librería/servicio para PDF e imagen.
- Proceso programado diario para generar obligaciones.
- Almacenamiento privado para comprobantes.
- Servicio de correo solo si posteriormente se aprueban invitaciones/notificaciones.

## 14.2 Decisiones cerradas para la versión 1.1

| ID | Dominio | Decisión |
|---|---|---|
| DEC-01 | Moneda | BOB y USD desde el MVP; saldos separados por moneda. |
| DEC-02 | Tipo de cambio | Sin conversión automática. Conversión explícita autorizada con tasa, fecha, dirección, fuente/usuario y snapshot. |
| DEC-03 | Períodos | Alquiler mensual por aniversario del inicio contractual. |
| DEC-04 | Vencimiento | Vence al inicio del período; mora informativa desde el día siguiente, sin multas/intereses automáticos. |
| DEC-05 | Prorrateo | Por días reales en períodos parciales, con vista previa del cálculo. |
| DEC-06 | Generación | Job diario idempotente, transaccional y protegido contra concurrencia; sin retroactividad automática. |
| DEC-07 | Caja | Caja independiente por usuario y moneda, con apertura, movimientos, arqueo, conciliación y cierre. |
| DEC-08 | Diferencias | Motivo y aprobación; caja cerrada no se reabre; ajustes posteriores compensatorios y vinculados. |
| DEC-09 | Gastos | Registro/aprobación/pago separados; pagos parciales y totales; solo pago confirmado genera egreso. |
| DEC-10 | Propietarios | Participaciones históricas; suma vigente 100%; reportes informativos por casa/propietario. |
| DEC-11 | Comisiones | Fuera del MVP; no hay cálculo ni distribución automática. |
| DEC-12 | Recibos | Correlativo por tenant/tipo, contador transaccional, PDF e imagen; comprobante interno no fiscal. |
| DEC-13 | Permisos | Por módulo/acción y opcionalmente por casa; propietario del tenant con acceso total. |
| DEC-14 | Dashboard | 5 filas por tabla en la vista inicial; filtro global Mes/Año. |
| DEC-15 | Reportes | Cobros/pagos por fecha efectiva; saldos a fecha de cierre; monedas separadas. |
| DEC-16 | Frecuencia | MVP mensual; cobro diario/semanal fuera de esta versión. |
| DEC-17 | Garantías | Depósitos y sus flujos quedan fuera del MVP. |

## 14.3 Único pendiente de validación de negocio

> ⚠️ **DATO FALTANTE**  
> **Descripción**: Confirmar la convención de períodos para contratos iniciados los días 29, 30 o 31 cuando el mes siguiente no contiene ese día.  
> **Impacto en el PRD**: Calendario de obligaciones, vencimientos y prorrateo.  
> **Riesgo asociado**: Diferencias en días facturados y en importes exigibles.  
> **Pregunta específica**: ¿Se aprueba conservar el día ancla original, usar el último día disponible en meses cortos y recuperar el ancla original al mes siguiente?  
> **Nivel de incertidumbre**: Alta

Esta convención se presenta como propuesta funcional, no como decisión previamente aprobada. Debe validarse antes de activar contratos con esos días de inicio.

# 15. KPIs

| KPI | Definición |
|---|---|
| Cobros del período | Suma de cobros confirmados por fecha efectiva |
| Saldo CxC al cierre del período | Suma de saldos pendientes de obligaciones del período |
| Saldo CxP al cierre del período | Saldo pendiente de gastos registrados hasta el último día del mes seleccionado, separado por moneda |
| Ocupación general | Unidades ocupadas al último día del mes / unidades habilitadas en esa fecha |
| Unidades ocupadas | Conteo de unidades con contrato vigente |
| Unidades libres | Unidades habilitadas sin contrato vigente |
| Inquilinos morosos | Personas únicas con al menos una obligación vencida y saldo pendiente |
| Egresos del período | Pagos de gastos confirmados por fecha efectiva dentro del mes, separado por moneda |
| Resultado operativo | Cobros confirmados menos pagos de gastos confirmados, con desglose por moneda |
| Diferencia de arqueo | Saldo contado menos saldo esperado |

Cada KPI deberá mostrar período, moneda, fórmula y acceso al detalle. No se sumarán monedas diferentes en un único total sin conversión explícita.

# 16. Matriz de trazabilidad

| Objetivo | Requerimientos | KPI | Criterio de aceptación ID | Entregable |
|---|---|---|---|---|
| OBJ-01 Administrar casas | RF-010 a RF-014 | Total de casas/unidades | CA-010 a CA-014 | Módulo de inmuebles |
| OBJ-02 Casa completa/cuarto | RF-011 a RF-014 | Ocupación general | CA-011 a CA-014 | Modelo de unidades |
| OBJ-03 Cuentas por cobrar | RF-022, RF-023, RF-030 a RF-032 | Saldo CxC | CA-022, CA-023, CA-030 a CA-032 | Contratos y CxC |
| OBJ-04 Cobros y recibos | RF-033 a RF-037 | Cobros del período | CA-033 a CA-037 | Cobranza y recibos |
| OBJ-05 Gastos y pagos | RF-040 a RF-045 | Saldo CxP y egresos | CA-040 a CA-045 | Gastos y CxP |
| OBJ-06 Caja y reportes | RF-050 a RF-058 | Resultado y diferencia de arqueo | CA-050 a CA-058 | Dashboard y reportes |
| OBJ-07 Aislamiento | RF-001 a RF-005 | Incidentes de acceso cruzado | CA-001 a CA-005 | Auth, RLS y permisos |

# 17. Entregables y plan de trabajo

## 17.1 Entregables

1. PRD LuchoRentas.
2. Diseño UX/UI responsive del dashboard y formularios.
3. Diagrama entidad-relación (ERD).
4. Matriz de roles y permisos.
5. Migraciones SQL y políticas RLS.
6. Funciones RPC y proceso de generación de CxC.
7. Frontend web.
8. Generación de recibos PDF e imagen.
9. Plan y casos de prueba funcionales, financieros y de seguridad.
10. Manual breve de usuario y guía de despliegue.

## 17.2 Roadmap por fases

Las duraciones se estimarán después de confirmar equipo, disponibilidad y decisiones pendientes. No se asignan fechas de calendario ni costos no proporcionados.

| Fase | Actividad | Duración | Dependencias | Entregable |
|---|---|---|---|---|
| F0 | Validación de calendario 29/30/31 y diseño UX | Por estimar | Aprobación DEC-18 | Flujos y prototipo |
| F1 | Auth, tenant, membresías, permisos y RLS | Por estimar | Proyecto Supabase | Fundación segura |
| F2 | Personas, casas, cuartos y propietarios | Por estimar | F1 | Módulos maestros |
| F3 | Contratos y generación de cuentas por cobrar | Por estimar | F2 y reglas de calendario | Contratos y CxC |
| F4 | Cobros, aplicaciones y recibos | Por estimar | F3 | Cobranza operativa |
| F5 | Gastos, proveedores, pagos parciales/totales, caja por usuario y arqueo | Por estimar | F1 y F2 | Control de egresos |
| F6 | Dashboard y reportes por casa/propietario | Por estimar | F3, F4 y F5 | Panel financiero |
| F7 | QA, seguridad, restauración y liberación | Por estimar | F1-F6 | Versión candidata a producción |

## 17.3 Quick wins

- Registro de casas y cuartos.
- Alta de inquilinos y contratos.
- Consulta de cuentas pendientes.
- Registro rápido de cobro con recibo.
- Registro rápido de gasto y pago.

# 18. Evaluación de factibilidad y validación final

## 18.1 Factibilidad

El alcance es técnicamente viable con una aplicación web monolítica modular y PostgreSQL administrado. No se requieren microservicios para el volumen funcional descrito. El mayor riesgo técnico está en la implementación correcta del aislamiento multi-tenant y la consistencia de las operaciones financieras.

La estimación de esfuerzo, costo y calendario se realizará al asignar equipo y disponibilidad; no se inventan costos ni fechas.

## 18.2 Pruebas mínimas obligatorias

- Un usuario de Tenant A no puede consultar datos de Tenant B por interfaz, API, SQL expuesto, descarga ni Storage.
- El propietario de un tenant puede consultar todos los datos de su tenant.
- Un colaborador solo puede ejecutar acciones permitidas.
- Un tenant puede crear múltiples casas.
- Una casa completa genera una única unidad alquilable.
- Una casa por cuartos permite alquilar unidades de forma independiente.
- No se permiten contratos incompatibles sobre una misma unidad.
- El proceso mensual genera una sola obligación por período.
- Un pago parcial deja el saldo correcto.
- Cada cobro confirmado genera un recibo único.
- Revertir un cobro conserva el original y registra el movimiento inverso.
- Un gasto no pagado no se refleja como egreso efectivo.
- Un pago de gasto confirmado genera una salida de caja.
- El arqueo detecta diferencias y exige explicación.
- El dashboard coincide con los reportes de detalle.
- Los reportes por propietario respetan las relaciones de propiedad configuradas.
- PDF e imagen del recibo contienen la misma información.

## 18.3 Definition of Done

Un módulo se considera terminado cuando:
- Cumple sus requerimientos funcionales y criterios de aceptación.
- Tiene validaciones frontend y backend.
- Respeta tenant, RLS y permisos.
- Tiene pruebas automatizadas de los flujos críticos.
- Registra auditoría cuando corresponde.
- No presenta defectos críticos o altos abiertos.
- Su documentación de usuario y técnica está actualizada.

## 18.4 Validación Markdown

- [x] Encabezados con jerarquía consistente.
- [x] Tablas simples y válidas.
- [x] Sin bloques de código anidados.
- [x] Sin HTML innecesario.
- [x] Listas consistentes.
- [x] Sin placeholders TODO sin explicación.
- [x] Compatible con GitHub, Notion y herramientas LLM.
- [x] Alcance reducido a control de rentas residenciales.

# 19. Feedback y validación final

## 19.1 Resultado de la revisión

Se revisó el PRD 1.0 contra las reglas aplicables del PRD Maestro Inmobiliario v5.3. Se corrigieron las reglas operativas que podían generar interpretaciones distintas entre desarrollo, finanzas y operación.

- Se cerraron 17 decisiones operativas.
- Queda una validación de negocio: calendario de contratos iniciados los días 29, 30 o 31.
- Se mantiene el producto enfocado en administración sencilla de rentas.
- No se trasladan al MVP módulos SaaS, contabilidad formal, garantías, comisiones ni liquidaciones complejas.

## 19.2 Feedback funcional y técnico

### Fortalezas
1. Flujo principal claro: inmueble/unidad → contrato → obligación → cobro/recibo → gasto/pago → caja → reporte.
2. Aislamiento multi-tenant con RLS y validación backend como requisito bloqueante.
3. Separación entre obligación, pago y movimiento de caja, evitando confundir devengo con dinero recibido/pagado.
4. BOB y USD separados, evitando reportes engañosos por conversiones implícitas.
5. Exclusión de comisiones y liquidaciones formales para mantener un MVP acotado.

### Riesgos que deben vigilarse
1. **Calendario y prorrateo:** es el único pendiente que puede cambiar importes cobrados; debe aprobarse antes de activar contratos con anclas 29/30/31.
2. **Caja por usuario:** el diseño UX debe mostrar claramente caja activa, saldo inicial, movimientos, arqueo y cierre.
3. **Multimoneda:** cada pantalla y reporte debe mostrar moneda explícita; nunca sumar BOB y USD.
4. **Recibos:** el correlativo debe asignarse dentro de la transacción de confirmación del cobro; renderizar PDF/imagen no debe volver a emitir.
5. **Permisos por casa:** deben aplicarse en RLS/RPC, no solo ocultarse en la interfaz.
6. **Reportes por propietario:** son informativos; no deben mostrar saldo liquidable ni deuda de la administración con el propietario.

## 19.3 Recomendaciones de implementación
- Construir primero Auth, tenants, membresías, permisos y pruebas RLS.
- Implementar operaciones financieras como RPC transaccionales.
- Mantener una única fuente de verdad para saldos: obligaciones, aplicaciones, pagos, reversiones y ajustes.
- Usar claves únicas e idempotencia para generación de alquileres y emisión de recibos.
- Construir el dashboard con consultas agregadas en PostgreSQL y filtro común de período/moneda.
- No incorporar garantías, liquidaciones formales, WhatsApp API, pagos online, facturación fiscal ni contabilidad formal al MVP.

## 19.4 Confirmación requerida

Solo requiere aprobación expresa el punto siguiente:

- **DEC-18 — Calendario 29/30/31:** aprobar o rechazar la convención propuesta en la sección 4.4.

El resto de las reglas operativas de la versión 1.1 queda especificado como baseline de desarrollo. Si DEC-18 se rechaza, debe documentarse la alternativa antes de implementar contratos con esas fechas de inicio.

## Referencias documentales

- PRD Maestro Inmobiliario v5.3: se reutilizan como referencia el aislamiento por tenant, membresías, RLS, personas con múltiples roles, casas/unidades, generación idempotente de obligaciones, cobros, recibos, gastos, caja, auditoría y reportes. Se excluyen del presente producto los módulos inmobiliarios y SaaS no necesarios para el control de rentas. 
- Framework Enterprise para Generación de PRDs Profesionales v2.1: estructura de análisis, trazabilidad, riesgos, factibilidad, plan de trabajo y validación.
- Reglas Maestras para Generar Archivos Markdown: formato defensivo, jerarquía y validación de integridad.


---

**Control de versión:** v1.1 — revisión funcional, cierre de decisiones operativas y feedback de implementación. Única validación de negocio pendiente: DEC-18.

**Validación de archivo v1.1:** encabezados y bloques Markdown balanceados; pendientes de negocio limitados a DEC-18. Las estimaciones de esfuerzo quedan sujetas a asignación de equipo.
