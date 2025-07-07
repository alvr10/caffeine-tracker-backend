// src/routes/drinks.ts (UPDATED to use middleware correctly)
import express from 'express';
import { supabase } from '../app';
import { authenticateUser, requireActiveSubscription, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateUser as any, requireActiveSubscription as any);

// Get all drinks (predefined + user's custom)
router.get('/', async (req: AuthRequest, res: any) => {
  try {
    const { data, error } = await supabase
      .from('drinks')
      .select('*')
      .or(`user_id.is.null,user_id.eq.${req.user!.id}`)
      .order('category', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch drinks' });
  }
});

// Create custom drink
router.post('/', async (req: AuthRequest, res: any) => {
  try {
    const { name, caffeine_per_serving, category, brand, serving_size } = req.body;

    if (!name || !caffeine_per_serving || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('drinks')
      .insert({
        name,
        caffeine_per_serving,
        category,
        brand,
        serving_size,
        is_custom: true,
        user_id: req.user!.id
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create drink' });
  }
});

// Update custom drink
router.put('/:id', async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;
    const { name, caffeine_per_serving, category, brand, serving_size } = req.body;

    const { data, error } = await supabase
      .from('drinks')
      .update({
        name,
        caffeine_per_serving,
        category,
        brand,
        serving_size
      })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .eq('is_custom', true)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'Drink not found or not authorized' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update drink' });
  }
});

// Delete custom drink
router.delete('/:id', async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('drinks')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .eq('is_custom', true);

    if (error) throw error;

    res.json({ message: 'Drink deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete drink' });
  }
});

export default router;