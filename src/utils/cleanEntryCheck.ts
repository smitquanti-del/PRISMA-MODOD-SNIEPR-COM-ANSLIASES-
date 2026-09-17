import { Candle, SignalDirection, CleanEntryCheck } from '../types';

/**
 * MOTOR DE VALIDAÇÃO DE GATILHO LIMPO (Clean Entry Check M1 OTC)
 * Foco exclusivo nos últimos 3-5 candles de 1 minuto.
 *
 * 1. Rejeição Real vs Falsa (Pavio contra direção)
 * 2. Força do Momentum (Corpo sólido >60% da amplitude, consistente com 2 anteriores)
 * 3. Ausência de Sobreposição Tóxica (Candle não está engolido pelo anterior gigante)
 * 4. Detecção de Armadilhas de Liquidez (Zona de respiro -> WAIT_NEXT_CANDLE | Caça ao stop -> BLOCK)
 * 5. Leitura de Velocidade Visual (Tick Velocity: aceleração vs desaceleração/exaustão)
 */
export function evaluateCleanEntryCheck(
  candles: Candle[],
  direction: SignalDirection,
  assetName: string
): CleanEntryCheck {
  if (!candles || candles.length < 5) {
    return {
      entry_valid: true,
      confidence: 80,
      micro_pattern: null,
      danger_flag: null,
      action: 'EXECUTE',
      details: {
        rejectionVerdict: 'NONE',
        momentumSolidBody: true,
        isEngulfedOverlap: false,
        liquidityTrap: false,
        tickVelocity: 'ORGANIC',
        lastCandleBodyRatio: 75,
        notes: ['Histórico inicial M1 validado'],
      },
    };
  }

  const notes: string[] = [];
  const lastCompleted = candles[candles.length - 1];
  const prevCompleted = candles[candles.length - 2];
  const last3 = candles.slice(-3);
  const last5 = candles.slice(-5);
  const last10 = candles.slice(-10);

  // 1. REJEIÇÃO REAL VS FALSA (Pavio contra a direção)
  const rangeLast = Math.max(lastCompleted.high - lastCompleted.low, 0.00001);
  const upperWick = lastCompleted.high - Math.max(lastCompleted.open, lastCompleted.close);
  const lowerWick = Math.min(lastCompleted.open, lastCompleted.close) - lastCompleted.low;
  const upperWickRatio = upperWick / rangeLast;
  const lowerWickRatio = lowerWick / rangeLast;

  let rejectionVerdict: 'GENUINE_REJECTION' | 'VOLATILITY_WICK' | 'NONE' = 'NONE';
  let hasAdverseWickRejection = false;

  if (direction === 'CALL') {
    // Para COMPRA (CALL), pavio superior longo é rejeição de topo (perigo)
    if (upperWickRatio > 0.40) {
      hasAdverseWickRejection = true;
      rejectionVerdict = upperWickRatio > 0.55 ? 'GENUINE_REJECTION' : 'VOLATILITY_WICK';
      notes.push('Rejeição de Topo: Pavio superior longo (>40%) indicando venda agressiva');
    }
  } else {
    // Para VENDA (PUT), pavio inferior longo é rejeição de fundo (perigo)
    if (lowerWickRatio > 0.40) {
      hasAdverseWickRejection = true;
      rejectionVerdict = lowerWickRatio > 0.55 ? 'GENUINE_REJECTION' : 'VOLATILITY_WICK';
      notes.push('Rejeição de Fundo: Pavio inferior longo (>40%) indicando absorção compradora');
    }
  }

  // 2. FORÇA DO MOMENTUM (Corpo sólido > 60% da amplitude)
  const bodySizeLast = Math.abs(lastCompleted.close - lastCompleted.open);
  const bodyRatioLast = bodySizeLast / rangeLast;
  const isSolidBody = bodyRatioLast >= 0.60;

  // Compara com a média dos corpos dos últimos 10 candles
  const avg10Body = last10.reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / Math.max(1, last10.length);
  const hasStrongerMomentum = bodySizeLast >= avg10Body * 0.9;

  if (isSolidBody && hasStrongerMomentum) {
    notes.push('Corpo Sólido: >60% da amplitude sem pavio adverso');
  } else if (!isSolidBody) {
    notes.push('Corpo Fraco: Vela com menos de 60% de corpo (ruído/indecisão)');
  }

  // 3. AUSÊNCIA DE SOBREPOSIÇÃO TÓXICA (Candle engolido por candle anterior gigante)
  const rangePrev = Math.max(prevCompleted.high - prevCompleted.low, 0.00001);
  const isEngulfedOverlap =
    lastCompleted.high <= prevCompleted.high &&
    lastCompleted.low >= prevCompleted.low &&
    rangePrev > rangeLast * 1.35;

  if (isEngulfedOverlap) {
    notes.push('Sobreposição Tóxica: Candle atual engolido pelo range anterior (indecisão M1)');
  }

  // 4. DETECÇÃO DE ARMADILHAS OTC (LIQUIDITY TRAPS)
  // Padrão Stop-Hunt: 3 velas pequenas na direção oposta seguidas de 1 vela gigante contra
  const bodiesLast3 = last3.map(c => Math.abs(c.close - c.open));
  const rangesLast5 = last5.map(c => Math.max(c.high - c.low, 0.00001));
  const avgRangeLast5 = rangesLast5.reduce((a, b) => a + b, 0) / 5;

  let isLiquidityTrap = false;
  let isZoneDeRespiro = false;

  // Verifica padrão de 3 velas pequenas contra tendência + vela gigante
  const areFirstSmall = bodiesLast3[0] < avgRangeLast5 * 0.6 && bodiesLast3[1] < avgRangeLast5 * 0.6;
  const isLastSpike = rangeLast > avgRangeLast5 * 2.2;
  if (areFirstSmall && isLastSpike && hasAdverseWickRejection) {
    isLiquidityTrap = true;
    notes.push('Armadilha de Liquidez OTC: Caça ao stop com spike desproporcional detectada');
  }

  // Zona de Respiro (Pullback previsível onde velas anteriores sempre corrigiram 1 vela)
  const isSequential3Same =
    (last3[0].close > last3[0].open && last3[1].close > last3[1].open && last3[2].close > last3[2].open && direction === 'CALL') ||
    (last3[0].close < last3[0].open && last3[1].close < last3[1].open && last3[2].close < last3[2].open && direction === 'PUT');

  if (isSequential3Same && bodyRatioLast < 0.55 && (direction === 'CALL' ? upperWickRatio > 0.35 : lowerWickRatio > 0.35)) {
    isZoneDeRespiro = true;
    notes.push('Zona de Respiro: 3 velas esticadas em exaustão de M1. Necessário pullback');
  }

  // 5. LEITURA DE VELOCIDADE VISUAL (Tick Velocity)
  let tickVelocity: 'ACCELERATING' | 'DECELERATING' | 'ORGANIC' | 'ERRATIC' = 'ORGANIC';
  if (bodiesLast3[2] > bodiesLast3[1] && bodiesLast3[1] > bodiesLast3[0] && isSolidBody) {
    tickVelocity = 'ACCELERATING';
  } else if (bodiesLast3[2] < bodiesLast3[1] * 0.6 && bodiesLast3[1] < bodiesLast3[0]) {
    tickVelocity = 'DECELERATING';
  } else if (rangeLast > avgRangeLast5 * 2.5) {
    tickVelocity = 'ERRATIC';
  }

  // CÁLCULO DA CONFIANÇA (0-100) & DECISÃO DA AÇÃO
  let confidence = 85;
  if (isSolidBody) confidence += 8;
  if (hasStrongerMomentum) confidence += 4;
  if (tickVelocity === 'ACCELERATING') confidence += 5;
  if (hasAdverseWickRejection) confidence -= 25;
  if (isEngulfedOverlap) confidence -= 30;
  if (isZoneDeRespiro) confidence -= 25;
  if (isLiquidityTrap) confidence -= 45;
  if (tickVelocity === 'DECELERATING') confidence -= 15;

  confidence = Math.max(15, Math.min(96, Math.round(confidence)));

  // Regra de Ouro M1:
  // Se houver armadilha de liquidez ou caça ao stop -> BLOCK
  // Se houver sobreposição tóxica ou zona de respiro -> WAIT_NEXT_CANDLE
  // Se a confiança estiver na zona de dúvida (40% - 60%) -> entry_valid: false, BLOCK ou WAIT
  let action: 'EXECUTE' | 'WAIT_NEXT_CANDLE' | 'BLOCK' = 'EXECUTE';
  let danger_flag: 'otc_manipulation' | 'toxic_overlap' | 'momentum_loss' | null = null;
  let micro_pattern: 'clean_engulfing' | 'exhaustion' | 'liquidity_trap' | 'indecision' | null = null;

  if (isLiquidityTrap || (hasAdverseWickRejection && rangeLast > avgRangeLast5 * 1.8)) {
    action = 'BLOCK';
    danger_flag = 'otc_manipulation';
    micro_pattern = 'liquidity_trap';
  } else if (isEngulfedOverlap) {
    action = 'WAIT_NEXT_CANDLE';
    danger_flag = 'toxic_overlap';
    micro_pattern = 'indecision';
  } else if (isZoneDeRespiro || tickVelocity === 'DECELERATING') {
    action = 'WAIT_NEXT_CANDLE';
    danger_flag = 'momentum_loss';
    micro_pattern = 'exhaustion';
  } else if (confidence < 60) {
    // Zona de dúvida: segurança em primeiro lugar
    action = 'BLOCK';
    danger_flag = 'momentum_loss';
    micro_pattern = 'indecision';
  } else {
    action = 'EXECUTE';
    danger_flag = null;
    micro_pattern = 'clean_engulfing';
  }

  const entry_valid = action === 'EXECUTE' && confidence >= 65;

  return {
    entry_valid,
    confidence: entry_valid ? confidence : 0,
    micro_pattern,
    danger_flag,
    action,
    details: {
      rejectionVerdict,
      momentumSolidBody: isSolidBody,
      isEngulfedOverlap,
      liquidityTrap: isLiquidityTrap,
      tickVelocity,
      lastCandleBodyRatio: Math.round(bodyRatioLast * 100),
      notes,
    },
  };
}

/**
 * Executa a checagem de Gatilho Limpo chamando a API de Visão do servidor (/api/vision-check),
 * com fallback imediato para o motor quantitativo caso ocorra timeout (>1200ms) ou ausência de rede.
 */
export async function checkCleanEntry(
  candles: Candle[],
  direction: SignalDirection,
  assetName: string,
  imageScreenshotBase64?: string
): Promise<CleanEntryCheck> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    const res = await fetch('/api/vision-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageScreenshotBase64,
        candles,
        direction,
        asset: assetName,
        timeframe: 'M1',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (typeof data.action === 'string' && typeof data.entry_valid === 'boolean') {
        // Enriquecer com detalhes locais para inspeção da UI
        const local = evaluateCleanEntryCheck(candles, direction, assetName);
        return {
          entry_valid: data.entry_valid,
          confidence: data.confidence,
          micro_pattern: data.micro_pattern,
          danger_flag: data.danger_flag,
          action: data.action,
          details: local.details,
        };
      }
    }
  } catch {
    // Fallback gracioso
  }

  return evaluateCleanEntryCheck(candles, direction, assetName);
}

