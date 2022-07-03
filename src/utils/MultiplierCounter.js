class MultiplierCounter {
    constructor() {
        this.Multiplier = 1;
        this._multiplierIncreaseProgress = 0;
        this._multiplierIncreaseMaxProgress = 2;
    }

    Reset() {
        this.Multiplier = 1;
        this._multiplierIncreaseProgress = 0;
        this._multiplierIncreaseMaxProgress = 2;
    }

    Increase() {
        if (this.Multiplier >= 8) return;

        if (this._multiplierIncreaseProgress < this._multiplierIncreaseMaxProgress)
        {
            this._multiplierIncreaseProgress += 1;
        }

        if (this._multiplierIncreaseProgress >= this._multiplierIncreaseMaxProgress)
        {
            this.Multiplier *= 2;
            this._multiplierIncreaseProgress = 0;
            this._multiplierIncreaseMaxProgress = this.Multiplier * 2;
        }
    }

    Decrease()
    {
        if (this._multiplierIncreaseProgress > 0)
        {
            this._multiplierIncreaseProgress = 0;
        }

        if (this.Multiplier > 1)
        {
            this.Multiplier /= 2;
            this._multiplierIncreaseMaxProgress = this.Multiplier * 2;
        }
    }
}

module.exports.MultiplierCounter = MultiplierCounter;