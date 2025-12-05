/*
 * --------------------------------------------------------------------
 *  Xoco POS — Point of Sale System
 *  Software Property of Xoco Café
 *  Copyright (c) 2025 Xoco Café
 *  Principal Developer: Donovan Riaño
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at:
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 *  --------------------------------------------------------------------
 *  PROPIEDAD DEL SOFTWARE — XOCO CAFÉ.
 *  Sistema Xoco POS — Punto de Venta.
 *  Desarrollador Principal: Donovan Riaño.
 *
 *  Este archivo está licenciado bajo Apache License 2.0.
 *  Consulta el archivo LICENSE en la raíz del proyecto para más detalles.
 * --------------------------------------------------------------------
 */

import { useState, useEffect, useCallback } from 'react';

type NetworkKey = 'ETHEREUM' | 'ARBITRUM' | 'OPTIMISM' | 'BASE' | 'ZKSYNC' | 'LIGHTNING';
type PaymentStatus = 'WAITING' | 'DETECTED' | 'CONFIRMED' | 'ERROR';

type PaymentDetails = {
  walletAddress?: string | null;
  expectedValueWei?: string | null;
  invoice?: string | null;
  tokenContractAddress?: string | null;
  expectedTokenAmount?: string | null;
};

const NETWORK_MODE = process.env.NEXT_PUBLIC_CHAIN_MODE === 'MAINNET' ? 'MAINNET' : 'TESTNET';

const COLORS: Record<PaymentStatus, string> = {
  WAITING: '#f1c40f',
  DETECTED: '#ff8c00',
  CONFIRMED: '#2ecc71',
  ERROR: 'red',
};

const getNetworkConfig = (network?: NetworkKey | null) => {
  const isTestnet = NETWORK_MODE === 'TESTNET';
  switch (network) {
    case 'ETHEREUM':
      return {
        baseUrl: isTestnet ? 'https://api-sepolia.etherscan.io/api' : 'https://api.etherscan.io/api',
        apiKey: process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY ?? null,
        isEVM: true,
      };
    case 'ARBITRUM':
      return {
        baseUrl: isTestnet
          ? 'https://api-sepolia.arbiscan.io/api'
          : 'https://api.arbiscan.io/api',
        apiKey: process.env.NEXT_PUBLIC_ARBISCAN_API_KEY ?? null,
        isEVM: true,
      };
    case 'OPTIMISM':
      return {
        baseUrl: isTestnet
          ? 'https://api-sepolia-optimism.etherscan.io/api'
          : 'https://api-optimistic.etherscan.io/api',
        apiKey: process.env.NEXT_PUBLIC_OPTIMISMSCAN_API_KEY ?? null,
        isEVM: true,
      };
    case 'BASE':
      return {
        baseUrl: isTestnet
          ? 'https://api-sepolia.basescan.org/api'
          : 'https://api.basescan.org/api',
        apiKey: process.env.NEXT_PUBLIC_BASESCAN_API_KEY ?? null,
        isEVM: true,
      };
    case 'ZKSYNC':
      return {
        baseUrl: isTestnet
          ? 'https://sepolia-era.zksync.network/api/v2'
          : 'https://blockscout.zksync.io/api',
        apiKey: null,
        isEVM: true,
      };
    case 'LIGHTNING':
      return {
        baseUrl: isTestnet
          ? process.env.NEXT_PUBLIC_LN_API_URL_TESTNET ?? ''
          : process.env.NEXT_PUBLIC_LN_API_URL_MAINNET ?? '',
        apiKey: isTestnet
          ? process.env.NEXT_PUBLIC_LN_API_KEY_TESTNET ?? null
          : process.env.NEXT_PUBLIC_LN_API_KEY_MAINNET ?? null,
        isEVM: false,
      };
    default:
      return { baseUrl: null, apiKey: null, isEVM: false };
  }
};

export function usePollingStatus(
  network?: NetworkKey | null,
  paymentDetails: PaymentDetails = {},
  interval = 5000
) {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('WAITING');
  const [statusText, setStatusText] = useState('Esperando pago…');

  const { walletAddress, expectedValueWei, invoice, tokenContractAddress, expectedTokenAmount } =
    paymentDetails;
  const config = getNetworkConfig(network);

  const checkPayment = useCallback(async () => {
    const missingLightningData = network === 'LIGHTNING' && !invoice;
    const missingEvmData =
      config.isEVM && (!walletAddress || (!tokenContractAddress && !expectedValueWei));
    if (!network || !config.baseUrl || missingLightningData || missingEvmData) {
      setPaymentStatus('ERROR');
      setStatusText(
        missingLightningData || missingEvmData
          ? 'Completa los datos del pago para iniciar el seguimiento.'
          : network
            ? `Red no configurada o no soportada: ${network} en modo ${NETWORK_MODE}`
            : 'Selecciona una red'
      );
      return;
    }
    try {
      if (network === 'LIGHTNING' && invoice) {
        const url = `${config.baseUrl.replace(/\/$/, '')}/wos-api/invoice-status?invoice=${encodeURIComponent(
          invoice
        )}&apikey=${config.apiKey ?? ''}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === 'settled' || data.paid === true) {
          setPaymentStatus('CONFIRMED');
          setStatusText('¡Pago LN Liquidado! 🟢');
          return;
        }
        if (data.status === 'pending' || data.status === 'in-flight') {
          setPaymentStatus('DETECTED');
          setStatusText('Pago LN en ruta…');
          return;
        }
      } else if (config.isEVM && walletAddress) {
        const filterAddress = tokenContractAddress ? `&contractaddress=${tokenContractAddress}` : '';
        const action = tokenContractAddress ? 'tokentx' : 'txlist';
        const amountToCheck = tokenContractAddress ? expectedTokenAmount : expectedValueWei;
        const apiKeyParam = config.apiKey ? `&apikey=${config.apiKey}` : '';
        const url = `${config.baseUrl}?module=account&action=${action}&address=${walletAddress}&startblock=0&sort=desc${filterAddress}${apiKeyParam}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === '1' && Array.isArray(data.result)) {
          const txFound = data.result.find((tx: Record<string, string>) => {
            const matchesAmount =
              typeof tx.value === 'string' && amountToCheck
                ? tx.value === amountToCheck
                : false;
            const isDeposit =
              typeof tx.to === 'string'
                ? tx.to.toLowerCase() === walletAddress.toLowerCase()
                : false;
            return matchesAmount && isDeposit;
          });
          if (txFound) {
            const confirmations = Number.parseInt(txFound.confirmations ?? '0', 10);
            if (Number.isFinite(confirmations) && confirmations >= 1) {
              setPaymentStatus('CONFIRMED');
              setStatusText('¡Pago Exitoso y Confirmado! 🟢');
              return;
            }
            setPaymentStatus('DETECTED');
            setStatusText('Pago detectado en mempool…');
            return;
          }
        }
      }
      if (paymentStatus !== 'CONFIRMED') {
        setPaymentStatus('WAITING');
        setStatusText('Esperando pago…');
      }
    } catch (error) {
      console.error('Error de conexión:', error);
      setPaymentStatus('ERROR');
      setStatusText('Error de conexión ⚠️');
    }
  }, [
    config.baseUrl,
    config.apiKey,
    config.isEVM,
    expectedTokenAmount,
    expectedValueWei,
    invoice,
    network,
    paymentStatus,
    tokenContractAddress,
    walletAddress,
  ]);

  useEffect(() => {
    const shouldPollLightning = network === 'LIGHTNING' && invoice;
    const shouldPollEvm = Boolean(config.isEVM && walletAddress);
    if (!network || (!shouldPollLightning && !shouldPollEvm)) {
      return;
    }
    void checkPayment();
    const timer = setInterval(checkPayment, interval);
    return () => clearInterval(timer);
  }, [checkPayment, interval, network, invoice, walletAddress, config.isEVM]);

  return {
    paymentStatus,
    statusText,
    semaforoColor: COLORS[paymentStatus],
  };
}
