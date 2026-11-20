# Plan y Casos de Prueba QA — LuchoRentas (v1.1)

> **Entregable §17.1 #9** · **Alcance:** Pruebas funcionales, financieras, de concurrencia, seguridad RLS multi-tenant y reconciliación Dashboard vs. Reportes conforme a `LuchoRentas.md` (§18.2 y §18.3).

---

## 1. Estrategia de Verificación

LuchoRentas aplica una estrategia de verificación en **3 capas**:

1. **Capa de Dominio Puro (Pruebas unitarias automatizadas con `node:test` + `tsx`):**
   - `src/lib/rbac.test.ts` — Aislamiento multi-tenant, membresías inactivas, alcance por casa (`DEC-13`) y permisos por rol/módulo.
   - `src/lib/phase2Domain.test.ts` — Casas completas vs. por cuartos, bloqueo de ocupación manual, suma 100% de copropietarios (`DEC-10`).
   - `src/lib/phase3Domain.test.ts` — Calendario por aniversario (`DEC-03`), días ancla `29/30/31` (`DEC-18`), prorrateo real (`DEC-05`), prevención de doble ocupación (`RF-014`) e idempotencia (`DEC-06`).
   - `src/lib/phase4Domain.test.ts` — Cobros completos/parciales, créditos separados por excedente (`§4.6`), reversiones auditadas, recibos correlativos (`DEC-12`).
   - `src/lib/phase5Domain.test.ts` — Gastos registro/aprobación/pago separados (`DEC-09`), cajas por usuario/moneda (`DEC-07`), arqueo con justificación (`RF-055`), validación de adjuntos.
   - `src/lib/phase6Domain.test.ts` — Exclusión de unidades `out_of_service`, conteo único de morosos, separación `BOB`/`USD` (`DEC-01`), reportes por casa y propietario sin comisiones (`DEC-11`).
   - `src/lib/phase7QaSuite.test.ts` — Cobertura integral explícita de las **17 pruebas mínimas obligatorias (§18.2)**, incluyendo paridad de datos entre recibos **PNG** y **PDF** (`CA-036`) y conciliación matemática **Dashboard ↔ Reportes**.

2. **Capa de Base de Datos (PostgreSQL / Supabase):**
   - `supabase/migrations/202611200007_phase7_qa_hardening.sql`: incorpora el RPC `run_tenant_qa_integrity_checks(p_tenant_id)` para auditar en vivo invariantes de copropiedad (100%), ocupación única, recibos 1:1, saldos CxC, unicidad de caja abierta, moneda consistente y pagos solo sobre gastos aprobados.
   - `supabase/qa/negative_rls_tests.sql`: suite transaccional (`BEGIN ... ROLLBACK`) para ejecutar directamente en Supabase SQL Editor y validar rechazo estricto de acceso cruzado entre tenants (`CA-003`), usuarios inactivos (`CA-004`), restricción por inmueble (`DEC-13`) y bloqueo de escrituras sin permiso (`CA-005`).

3. **Capa de Interfaz y Navegación (Browser Check + Compilación):**
   - Compilación `vite build` y verificación de tipos `tsc --noEmit` sin errores.
   - Inspección visual en Chromium headless en escritorios (`1440×900`) y móvil (`390×844`) validando ausencia de errores de consola, legibilidad de contraste en tema oscuro/claro y ausencia de desbordamientos horizontales.

---

## 2. Matriz de Trazabilidad de Pruebas Obligatorias (§18.2)

| # | Prueba mínima obligatoria (`LuchoRentas.md §18.2`) | Criterios | Verificación automatizada / SQL | Estado |
|---|---|---|---|---|
| 1 | Usuario de Tenant A no puede consultar datos de Tenant B por interfaz, API, SQL expuesto ni Storage | CA-003, DEC-13 | `rbac.test.ts`, `phase7QaSuite.test.ts`, `negative_rls_tests.sql` | Cubierto |
| 2 | Propietario de un tenant puede consultar todos los datos de su tenant | CA-005 | `rbac.test.ts`, `phase7QaSuite.test.ts`, `negative_rls_tests.sql` | Cubierto |
| 3 | Colaborador solo puede ejecutar acciones permitidas | CA-005, DEC-13 | `rbac.test.ts`, `phase7QaSuite.test.ts`, `negative_rls_tests.sql` | Cubierto |
| 4 | Un tenant puede crear múltiples casas | CA-010 | `phase2Domain.test.ts`, `phase7QaSuite.test.ts` | Cubierto |
| 5 | Casa completa genera una única unidad alquilable | CA-011 | `0002_phase2_properties_people.sql`, `phase7QaSuite.test.ts` | Cubierto |
| 6 | Casa por cuartos permite alquilar unidades de forma independiente | CA-012 | `phase3Domain.test.ts`, `phase7QaSuite.test.ts` | Cubierto |
| 7 | No se permiten contratos incompatibles sobre una misma unidad | CA-014, RF-014 | `phase3Domain.test.ts`, `phase7QaSuite.test.ts`, `run_tenant_qa_integrity_checks` | Cubierto |
| 8 | Proceso mensual genera una sola obligación por período | CA-030, CA-031, DEC-06 | `phase3Domain.test.ts`, `phase7QaSuite.test.ts`, índice `uq_receivable_contract_period` | Cubierto |
| 9 | Pago parcial deja el saldo correcto | CA-033 | `phase4Domain.test.ts`, `phase7QaSuite.test.ts` | Cubierto |
| 10 | Cada cobro confirmado genera un recibo único | CA-035, DEC-12 | `phase4Domain.test.ts`, `phase7QaSuite.test.ts`, `run_tenant_qa_integrity_checks` | Cubierto |
| 11 | Revertir un cobro conserva el original y registra movimiento inverso | CA-037 | `phase4Domain.test.ts`, `phase7QaSuite.test.ts`, `0004_phase4_collections_receipts.sql` | Cubierto |
| 12 | Gasto no pagado no se refleja como egreso efectivo | CA-042, DEC-09 | `phase6Domain.test.ts`, `phase7QaSuite.test.ts` | Cubierto |
| 13 | Pago de gasto confirmado genera salida de caja | CA-043, §4.8 | `phase5Domain.test.ts`, `phase7QaSuite.test.ts`, `0005_phase5_expenses_cash.sql` | Cubierto |
| 14 | Arqueo detecta diferencias y exige explicación | CA-055, DEC-08 | `phase5Domain.test.ts`, `phase7QaSuite.test.ts` | Cubierto |
| 15 | Dashboard coincide con los reportes de detalle | CA-050 a CA-058 | `phase7QaSuite.test.ts` + conciliación en *Estado y Seguridad* | Cubierto |
| 16 | Reportes por propietario respetan participaciones configuradas | CA-057, DEC-10, DEC-11 | `phase6Domain.test.ts`, `phase7QaSuite.test.ts` | Cubierto |
| 17 | PDF e imagen PNG del recibo contienen la misma información | CA-036 | `phase7QaSuite.test.ts` (`extractReceiptDisplayFields`) | Cubierto |

---

## 3. Cómo Ejecutar las Pruebas antes de Cada Despliegue (§12)

### 3.1 Suite unitaria e integración de dominio (local / CI)

```bash
npx --yes tsx --test \
  src/lib/rbac.test.ts \
  src/lib/phase2Domain.test.ts \
  src/lib/phase3Domain.test.ts \
  src/lib/phase4Domain.test.ts \
  src/lib/phase5Domain.test.ts \
  src/lib/phase6Domain.test.ts \
  src/lib/phase7QaSuite.test.ts
```

### 3.2 Validación de compilación y tipado estricto

```bash
npm run lint
npm run build
```

### 3.3 Pruebas negativas RLS en PostgreSQL (TEST/QA o STAGING)

1. Abrir **Supabase SQL Editor** en el proyecto de QA/Staging.
2. Pegar y ejecutar íntegramente `supabase/qa/negative_rls_tests.sql`.
3. Verificar el mensaje: `OK FASE 7: Todas las pruebas negativas de RLS, multi-tenant y DEC-13 pasaron correctamente.` (el script ejecuta `ROLLBACK` automático al final).

### 3.4 Auditoría viva desde la aplicación

1. Iniciar sesión con rol `tenant_owner` o `admin`.
2. Ir a **Estado y Seguridad** en el menú lateral.
3. Hacer clic en **Validar datos ahora** y luego en **Ejecutar auditoría QA** para verificar los 7 invariantes SQL más la conciliación Dashboard ↔ Reportes.
