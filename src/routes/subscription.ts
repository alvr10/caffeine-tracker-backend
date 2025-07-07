// src/routes/subscription.ts - Fixed with proper validation, no trial
import express from 'express';
import { stripe, supabase } from '../app';
import { authenticateUser, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Helper function to convert timestamp to ISO string with validation
const timestampToISOString = (timestamp: number | undefined | null): string | null => {
  if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp)) {
    console.warn('Invalid timestamp received:', timestamp);
    return null;
  }

  try {
    const date = new Date(timestamp * 1000);
    if (isNaN(date.getTime())) {
      console.warn('Invalid date created from timestamp:', timestamp);
      return null;
    }
    return date.toISOString();
  } catch (error) {
    console.error('Error converting timestamp to ISO string:', timestamp, error);
    return null;
  }
};

// Create setup intent
router.post('/setup-intent', authenticateUser as any, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', req.user!.id)
      .single();

    let customer_id = '';

    if (profile?.stripe_customer_id) {
      customer_id = profile.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: req.user!.email,
        metadata: { user_id: req.user!.id },
      });
      customer_id = customer.id;

      await supabase
        .from('user_profiles')
        .upsert({
          id: req.user!.id,
          email: req.user!.email,
          stripe_customer_id: customer_id,
        });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer_id,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    res.json({
      client_secret: setupIntent.client_secret,
      customer_id: customer_id,
      setup_intent_id: setupIntent.id,
    });
  } catch (error) {
    console.error('Setup intent error:', error);
    res.status(500).json({ error: 'Failed to create setup intent' });
  }
});

// Create subscription
router.post('/create', authenticateUser as any, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { customer_id, setup_intent_id } = req.body;

    if (!customer_id) {
      res.status(400).json({ error: 'customer_id is required' });
      return;
    }

    // Get payment method
    let defaultPaymentMethod = null;

    if (setup_intent_id) {
      const setupIntent = await stripe.setupIntents.retrieve(setup_intent_id);
      if (setupIntent.payment_method && setupIntent.status === 'succeeded') {
        defaultPaymentMethod = setupIntent.payment_method;
      }
    }

    if (!defaultPaymentMethod) {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customer_id,
        type: 'card',
      });
      if (paymentMethods.data.length > 0) {
        defaultPaymentMethod = paymentMethods.data[0].id;
      }
    }

    if (!defaultPaymentMethod) {
      res.status(400).json({ error: 'No payment method found' });
      return;
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer_id,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      default_payment_method: defaultPaymentMethod as string,
      payment_behavior: 'error_if_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    if (subscription.status === 'active') {
      // FIXED: Use current_period_end directly if available, fallback to calculation
      let periodEnd = (subscription as any).current_period_end;

      if (!periodEnd && (subscription as any).billing_cycle_anchor) {
        const billingAnchor = (subscription as any).billing_cycle_anchor;
        // Add 1 month (30 days) to billing anchor for monthly subscription
        periodEnd = billingAnchor + (30 * 24 * 60 * 60); // 30 days in seconds
        console.log('Calculated period_end from billing_cycle_anchor:', periodEnd);
      }

      // FIXED: Only process if we have a valid periodEnd
      let expiresAt = null;
      if (periodEnd) {
        expiresAt = timestampToISOString(periodEnd);
      }

      const updateData: any = {
        subscription_id: subscription.id,
        subscription_status: subscription.status,
      };

      // Only set expires_at if we have a valid date
      if (expiresAt) {
        updateData.subscription_expires_at = expiresAt;
      }

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('id', req.user!.id);

      if (updateError) {
        console.error('Error updating user profile:', updateError);
      }

      res.json({
        subscription_id: subscription.id,
        status: subscription.status,
        current_period_end: periodEnd,
        expires_at: expiresAt,
      });
    } else {
      console.log('Subscription not active, status:', subscription.status);
      res.status(400).json({ error: 'Subscription creation failed' });
    }
  } catch (error: any) {
    console.error('Subscription creation error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Get subscription status
router.get('/status', authenticateUser as any, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    if (!profile?.subscription_id) {
      res.json({ status: 'inactive' });
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(profile.subscription_id);

    if (subscription.status === 'active') {
      let periodEnd = (subscription as any).current_period_end;
      const cancelAtPeriodEnd = (subscription as any).cancel_at_period_end;

      // FIXED: Better fallback handling
      if (!periodEnd && (subscription as any).billing_cycle_anchor) {
        const billingAnchor = (subscription as any).billing_cycle_anchor;
        periodEnd = billingAnchor + (30 * 24 * 60 * 60);
      }

      // FIXED: Only process timestamp if valid
      let expiresAt = null;
      if (periodEnd) {
        expiresAt = timestampToISOString(periodEnd);
      }

      // Determine the correct status
      let status = 'active';
      if (cancelAtPeriodEnd) {
        status = 'active_until_period_end';
      }

      // Update database with current status only if we have valid data
      const updateData: any = {
        subscription_status: status,
      };

      if (expiresAt && expiresAt !== profile.subscription_expires_at) {
        updateData.subscription_expires_at = expiresAt;
      }

      if (Object.keys(updateData).length > 1 || updateData.subscription_status !== profile.subscription_status) {
        await supabase
          .from('user_profiles')
          .update(updateData)
          .eq('id', req.user!.id);
      }

      res.json({
        status: status,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
        expires_at: expiresAt,
        will_renew: !cancelAtPeriodEnd
      });
    } else {
      // Subscription is no longer active
      await supabase
        .from('user_profiles')
        .update({
          subscription_status: 'inactive',
          subscription_id: null,
          subscription_expires_at: null,
        })
        .eq('id', req.user!.id);

      res.json({ status: 'inactive' });
    }
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// Cancel subscription
router.post('/cancel', authenticateUser as any, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('subscription_id')
      .eq('id', req.user!.id)
      .single();

    if (!profile?.subscription_id) {
      res.status(404).json({ error: 'No active subscription found' });
      return;
    }

    // Schedule cancellation at period end (user keeps access)
    const subscription = await stripe.subscriptions.update(profile.subscription_id, {
      cancel_at_period_end: true,
    });

    // Update database to show cancellation is scheduled
    await supabase
      .from('user_profiles')
      .update({
        subscription_status: 'active_until_period_end',
      })
      .eq('id', req.user!.id);

    // FIXED: Handle undefined current_period_end properly
    let periodEnd = (subscription as any).current_period_end;

    // Use billing_cycle_anchor as fallback if current_period_end is undefined
    if (!periodEnd && (subscription as any).billing_cycle_anchor) {
      const billingAnchor = (subscription as any).billing_cycle_anchor;
      periodEnd = billingAnchor + (30 * 24 * 60 * 60); // Add 30 days
    }

    // Only convert to ISO string if we have a valid period end
    const periodEndDate = periodEnd ? timestampToISOString(periodEnd) : null;

    res.json({
      message: 'Subscription cancelled - access until period end',
      cancel_at_period_end: true,
      current_period_end: periodEnd,
      access_until: periodEndDate,
      status: 'active_until_period_end'
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

router.post('/reactivate', authenticateUser as any, async (req: AuthRequest, res): Promise<void> => {
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('subscription_id')
      .eq('id', req.user!.id)
      .single();

    if (!profile?.subscription_id) {
      res.status(404).json({ error: 'No subscription found' });
      return;
    }

    // Remove the cancellation
    const subscription = await stripe.subscriptions.update(profile.subscription_id, {
      cancel_at_period_end: false,
    });

    // Update database
    await supabase
      .from('user_profiles')
      .update({
        subscription_status: 'active',
      })
      .eq('id', req.user!.id);

    res.json({
      message: 'Subscription reactivated successfully',
      status: 'active',
      will_renew: true
    });
  } catch (error) {
    console.error('Reactivate subscription error:', error);
    res.status(500).json({ error: 'Failed to reactivate subscription' });
  }
});

// Webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    const eventObject = event.data.object as any;

    switch (event.type) {
      case 'customer.subscription.deleted':
        // This fires when subscription actually ends (scheduled cancellation completes)
        await supabase
          .from('user_profiles')
          .update({
            subscription_status: 'cancelled',
            subscription_id: null,
            subscription_expires_at: null,
          })
          .eq('stripe_customer_id', eventObject.customer);
        break;

      case 'customer.subscription.updated':
        if (eventObject.status === 'active') {
          let updatedPeriodEnd = (eventObject as any).current_period_end;
          const cancelAtPeriodEnd = (eventObject as any).cancel_at_period_end;

          if (!updatedPeriodEnd && (eventObject as any).billing_cycle_anchor) {
            const billingAnchor = (eventObject as any).billing_cycle_anchor;
            updatedPeriodEnd = billingAnchor + (30 * 24 * 60 * 60);
          }

          const updatedExpiresAt = timestampToISOString(updatedPeriodEnd);

          // Set correct status based on cancellation
          let status = 'active';
          if (cancelAtPeriodEnd) {
            status = 'active_until_period_end';
          }

          const webhookUpdateData: any = {
            subscription_status: status,
          };

          if (updatedExpiresAt) {
            webhookUpdateData.subscription_expires_at = updatedExpiresAt;
          }

          await supabase
            .from('user_profiles')
            .update(webhookUpdateData)
            .eq('stripe_customer_id', eventObject.customer);
        }
        break;

      // ... other existing webhook cases
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook signature verification failed' });
  }
});

export default router;