// UPDATE src/middleware/auth.ts - Fix the requireActiveSubscription function
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../app';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    subscription_status: string;
  };
}

export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user profile with subscription status
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    req.user = {
      id: user.id,
      email: user.email!,
      subscription_status: profile?.subscription_status || 'inactive'
    };

    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const requireActiveSubscription = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const status = req.user?.subscription_status;

  // FIXED: Allow both active and active_until_period_end
  if (status === 'active' || status === 'active_until_period_end') {
    next();
  } else {
    return res.status(403).json({
      error: 'Active subscription required',
      subscription_status: status
    });
  }
};