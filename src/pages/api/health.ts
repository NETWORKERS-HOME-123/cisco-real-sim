/**
 * Health Check API Endpoint
 */

import type { NextApiRequest, NextApiResponse } from 'next';

type HealthResponse = {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
