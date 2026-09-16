export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'SCALP-Ω AI Webhook',
      status: 'online'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body ?? {};

    console.log('TradingView webhook received:', body);

    return res.status(200).json({
      ok: true,
      received: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({
      ok: false,
      error: 'Invalid request'
    });
  }
}
