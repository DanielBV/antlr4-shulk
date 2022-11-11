
import antlr4 from 'antlr4';

export function intervalToArray(interval) {
    let values= [];
    let n = interval.intervals.length;
    for (let i = 0; i < n; i++) {
      let I = interval.intervals[i];
      let a = I.start;
      let b = I.stop;
      // Careful. Intervals are open in the right, thats why < and not <=
      for (let v = a; v < b; v++) {
        values.push(v);
      }
    }
  
    return values;
  }

// I copied 99.9999% of this code from ANTLR4's official javascript target (IntervalSet.js).
// The problem is it has a bug and doesn't calculate the complement correctly when this = [1,3], start = 1 and stop = 4.
export function complement(start, stop) {
    const result = new antlr4.IntervalSet();
    result.addInterval(new antlr4.Interval(start, stop + 1));
    if (this.intervals !== null) this.intervals.forEach(toRemove => removeRange.bind(result)(toRemove));
    return result;
}
  
export function removeRange(toRemove) {
    if(toRemove.start===toRemove.stop-1) {
      this.removeOne(toRemove.start);
    } else if (this.intervals !== null) {
      let pos = 0;
      for(let n=0; n<this.intervals.length; n++) {
        const existing = this.intervals[pos];
        // intervals are ordered
        if (toRemove.stop<=existing.start) {
          return;
        }
        // check for including range, split it
        // <------- The line below is the only change I have made. In antlr4 default JS implementation it's > and < instead of >= and <= but 
        // that doesn't seem to be working when expected = [1,4] and toRemove = [1,3]  ------->
        else if(toRemove.start>=existing.start && toRemove.stop<=existing.stop) {
          this.intervals[pos] = new antlr4.Interval(existing.start, toRemove.start);
          const x = new antlr4.Interval(toRemove.stop, existing.stop);
          this.intervals.splice(pos, 0, x);
          return;
        }
        // check for included range, remove it
        else if(toRemove.start<=existing.start && toRemove.stop>=existing.stop) {
          this.intervals.splice(pos, 1);
          pos = pos - 1; // need another pass
        }
        // check for lower boundary
        else if(toRemove.start<existing.stop) {
          this.intervals[pos] = new antlr4.Interval(existing.start, toRemove.start);
        }
        // check for upper boundary
        else if(toRemove.stop<existing.stop) {
          this.intervals[pos] = new antlr4.Interval(toRemove.stop, existing.stop);
        }
        pos += 1;
      }
    }
  }