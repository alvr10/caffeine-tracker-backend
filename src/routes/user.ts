// src/routes/user.ts
import express from 'express';
import { supabase } from '../app';
import { authenticateUser, requireActiveSubscription, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateUser as any, requireActiveSubscription as any);

// Get user profile
router.get('/profile', async (req: AuthRequest, res: any) => {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update daily caffeine limit
router.put('/daily-limit', async (req: AuthRequest, res: any) => {
  try {
    const { daily_caffeine_limit } = req.body;

    if (!daily_caffeine_limit || daily_caffeine_limit < 50 || daily_caffeine_limit > 1000) {
      return res.status(400).json({ error: 'Daily limit must be between 50-1000mg' });
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update({ daily_caffeine_limit })
      .eq('id', req.user!.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update daily limit' });
  }
});

export default router;