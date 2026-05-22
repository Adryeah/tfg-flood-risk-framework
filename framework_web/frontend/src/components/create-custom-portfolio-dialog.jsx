import React, { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api.js';

/**
 * Custom portfolio creation dialog.
 *
 * Posts to /api/portfolios/custom and bubbles the generated portfolio
 * up via `onCreated(portfolio)` so the parent can:
 *   - prepend it to the predefined list (so the user sees it in the picker)
 *   - select it as the active portfolio
 *
 * Backend schema (CustomPortfolioRequest):
 *   - n_clients: int 1..10000
 *   - value_range: [min, max] EUR
 *   - type_distribution: { residential, commercial, industrial } sums to 1
 *   - geographic_focus: 'valencia' | 'algemesi' | 'both'
 *   - seed: optional int
 *
 * Note: backend still uses LEGACY type names. We expose the modern
 * particulares / pymes / autos labels in the UI and map back here.
 */
const LEGACY_BY_PRODUCT = {
  particulares: 'residential',
  pymes: 'commercial',
  autos: 'industrial', // backend's `industrial` bucket maps to autos in our taxonomy
};

const PRESETS = {
  balanced: { particulares: 0.5, pymes: 0.3, autos: 0.2 },
  residential_heavy: { particulares: 0.85, pymes: 0.1, autos: 0.05 },
  pymes_focus: { particulares: 0.2, pymes: 0.7, autos: 0.1 },
  motor: { particulares: 0.2, pymes: 0.1, autos: 0.7 },
};

function fmtMoney(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `€${m.toFixed(1).replace(/\.0$/, '')}M`;
  }
  return `€${(v / 1000).toFixed(0)}K`;
}

export function CreateCustomPortfolioDialog({ open, onOpenChange, onCreated }) {
  const [nClients, setNClients] = useState(500);
  const [valueRange, setValueRange] = useState([50_000, 1_500_000]);
  const [preset, setPreset] = useState('balanced');
  const [mix, setMix] = useState(PRESETS.balanced);
  const [geographic, setGeographic] = useState('both');
  const [seed, setSeed] = useState(123);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const applyPreset = (key) => {
    setPreset(key);
    setMix(PRESETS[key] || PRESETS.balanced);
  };

  // The 3 mix sliders are interdependent — when one moves, the other
  // two share the remainder proportionally so the sum stays 1.0.
  const setProduct = (which, val) => {
    const others = Object.keys(mix).filter((k) => k !== which);
    const remaining = 1 - val;
    const otherSum = others.reduce((s, k) => s + mix[k], 0) || 1;
    const next = { ...mix, [which]: val };
    for (const k of others) {
      next[k] = remaining * (mix[k] / otherSum);
    }
    setMix(next);
    setPreset('custom');
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Backend expects residential/commercial/industrial → translate.
      const type_distribution = {
        residential: mix.particulares,
        commercial: mix.pymes,
        industrial: mix.autos,
      };
      const portfolio = await api.portfolio.createCustom({
        n_clients: nClients,
        value_range: valueRange,
        type_distribution,
        geographic_focus: geographic,
        seed,
      });
      // Give it a human name + persist locally
      portfolio.name = `Custom · ${nClients.toLocaleString()} polizas`;
      portfolio.description = `Custom portfolio · ${geographic} · ${(mix.particulares * 100).toFixed(0)}/${(mix.pymes * 100).toFixed(0)}/${(mix.autos * 100).toFixed(0)} mix`;
      onCreated?.(portfolio);
      onOpenChange?.(false);
    } catch (err) {
      console.error('createCustom failed', err);
      setError(err?.message || 'Failed to create portfolio');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-16 flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-brand-700" strokeWidth={1.75} />
            Crear cartera personalizada
          </DialogTitle>
          <DialogDescription className="text-12">
            Genera una cartera sintética nueva con tus parámetros. Las pólizas
            se sortean sobre la superficie de riesgo modelada (Valencia,
            Algemesí o ambas).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Number of clients */}
          <FieldRow label="Número de pólizas" value={nClients.toLocaleString()}>
            <Slider
              min={50}
              max={2000}
              step={50}
              value={[nClients]}
              onValueChange={(v) => setNClients(v[0])}
            />
            <Helper>Entre 50 y 2.000 — afecta tiempo de generación (~2-8 s)</Helper>
          </FieldRow>

          {/* Value range */}
          <FieldRow
            label="Rango de valor asegurado"
            value={`${fmtMoney(valueRange[0])} — ${fmtMoney(valueRange[1])}`}
          >
            <Slider
              min={10_000}
              max={5_000_000}
              step={10_000}
              value={valueRange}
              onValueChange={(v) => setValueRange(v)}
            />
            <Helper>Las pólizas se muestrearán dentro de este rango</Helper>
          </FieldRow>

          {/* Product mix */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-11 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
                Distribución de producto
              </span>
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger className="w-[180px] h-7 text-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced" className="text-12">
                    Balanceada (50/30/20)
                  </SelectItem>
                  <SelectItem value="residential_heavy" className="text-12">
                    Residencial pesado (85/10/5)
                  </SelectItem>
                  <SelectItem value="pymes_focus" className="text-12">
                    Foco pymes (20/70/10)
                  </SelectItem>
                  <SelectItem value="motor" className="text-12">
                    Motor (20/10/70)
                  </SelectItem>
                  <SelectItem value="custom" className="text-12">
                    Personalizada
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <MixRow
                label="Particulares"
                color="#2563EB"
                value={mix.particulares}
                onChange={(v) => setProduct('particulares', v)}
              />
              <MixRow
                label="Pymes"
                color="#D97706"
                value={mix.pymes}
                onChange={(v) => setProduct('pymes', v)}
              />
              <MixRow
                label="Autos"
                color="#7C3AED"
                value={mix.autos}
                onChange={(v) => setProduct('autos', v)}
              />
            </div>
          </div>

          {/* Geographic focus + seed */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-11 font-mono font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">
                Zona geográfica
              </div>
              <Select value={geographic} onValueChange={setGeographic}>
                <SelectTrigger className="h-9 text-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="valencia" className="text-12">
                    Valencia (entrenamiento)
                  </SelectItem>
                  <SelectItem value="algemesi" className="text-12">
                    Algemesí (extrapolación)
                  </SelectItem>
                  <SelectItem value="both" className="text-12">
                    Ambas zonas
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-11 font-mono font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">
                Semilla aleatoria
              </div>
              <Input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value, 10) || 0)}
                className="h-9 text-12 font-mono"
              />
            </div>
          </div>

          {error && (
            <div className="text-12 text-risk-high bg-risk-high-bg border border-risk-high/20 rounded p-2">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange?.(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                Generando…
              </>
            ) : (
              'Crear cartera'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ label, value, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-11 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          {label}
        </span>
        <span className="text-12 font-mono font-medium text-text-primary tabular-nums">
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}

function Helper({ children }) {
  return (
    <div className="text-10 text-text-tertiary mt-1.5">{children}</div>
  );
}

function MixRow({ label, color, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1.5 text-12 text-text-primary w-[110px] shrink-0">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: color }}
        />
        {label}
      </span>
      <Slider
        min={0}
        max={1}
        step={0.05}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        className="flex-1"
      />
      <span className="text-12 font-mono tabular-nums w-[48px] text-right text-text-primary">
        {(value * 100).toFixed(0)} %
      </span>
    </div>
  );
}
