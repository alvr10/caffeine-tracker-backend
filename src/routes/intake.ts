// src/routes/intake.ts (UPDATED to use middleware correctly)
import express from 'express';
import { supabase } from '../app';
import { authenticateUser, requireActiveSubscription, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateUser as any, requireActiveSubscription as any);

// Log caffeine intake
router.post('/', async (req: AuthRequest, res: any) => {
  try {
    const { drink_id, servings = 1, consumed_at, notes } = req.body;

    if (!drink_id) {
      return res.status(400).json({ error: 'drink_id is required' });
    }

    // Get drink info to calculate total caffeine
    const { data: drink, error: drinkError } = await supabase
      .from('drinks')
      .select('caffeine_per_serving')
      .eq('id', drink_id)
      .single();

    if (drinkError || !drink) {
      return res.status(404).json({ error: 'Drink not found' });
    }

    const total_caffeine = Math.round(drink.caffeine_per_serving * servings);
    const consumedDate = consumed_at ? new Date(consumed_at) : new Date();

    const { data, error } = await supabase
      .from('intake_logs')
      .insert({
        user_id: req.user!.id,
        drink_id,
        servings,
        total_caffeine,
        consumed_at: consumedDate.toISOString(),
        date: consumedDate.toISOString().split('T')[0],
        notes
      })
      .select(`
        *,
        drinks:drink_id (
          id,
          name,
          caffeine_per_serving,
          category,
          brand,
          serving_size
        )
      `)
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to log intake' });
  }
});

// Get daily intake
router.get('/daily/:date', async (req: AuthRequest, res: any) => {
  try {
    const { date } = req.params;

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const { data, error } = await supabase
      .from('intake_logs')
      .select(`
        *,
        drinks:drink_id (
          id,
          name,
          caffeine_per_serving,
          category,
          brand,
          serving_size
        )
      `)
      .eq('user_id', req.user!.id)
      .eq('date', date)
      .order('consumed_at', { ascending: false });

    if (error) throw error;

    const totalCaffeine = data.reduce((sum, log) => sum + log.total_caffeine, 0);

    res.json({
      date,
      total_caffeine: totalCaffeine,
      logs: data
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch daily intake' });
  }
});

// Get intake history (last 30 days)
router.get('/history', async (req: AuthRequest, res: any) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from('intake_logs')
      .select('date, total_caffeine')
      .eq('user_id', req.user!.id)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) throw error;

    // Group by date and sum caffeine
    const dailyTotals = data.reduce((acc, log) => {
      if (!acc[log.date]) {
        acc[log.date] = 0;
      }
      acc[log.date] += log.total_caffeine;
      return acc;
    }, {} as Record<string, number>);

    res.json(dailyTotals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch intake history' });
  }
});

// Update intake log
router.put('/:id', async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;
    const { servings, consumed_at, notes } = req.body;

    // Get current log to recalculate caffeine
    const { data: currentLog, error: fetchError } = await supabase
      .from('intake_logs')
      .select('*, drinks:drink_id (caffeine_per_serving)')
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (fetchError || !currentLog) {
      return res.status(404).json({ error: 'Intake log not found or not authorized' });
    }

    const total_caffeine = Math.round(currentLog.drinks.caffeine_per_serving * servings);
    const consumedDate = consumed_at ? new Date(consumed_at) : new Date(currentLog.consumed_at);

    const { data, error } = await supabase
      .from('intake_logs')
      .update({
        servings,
        total_caffeine,
        consumed_at: consumedDate.toISOString(),
        date: consumedDate.toISOString().split('T')[0],
        notes
      })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update intake log' });
  }
});

// Delete intake log
router.delete('/:id', async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('intake_logs')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user!.id);

    if (error) throw error;

    res.json({ message: 'Intake log deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete intake log' });
  }
});

export default router;